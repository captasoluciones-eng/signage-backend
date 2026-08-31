"""
Non-blocking heartbeat ingestion.

POST /heartbeat must return 204 immediately and never make the *player*
wait on Firestore or BigQuery I/O. We push each heartbeat into an in-memory
list guarded by an asyncio.Lock, and flush it:
  - one Firestore batched write (latest-state merge into devices/{id}, plus
    one heartbeat history doc per device, subject to Firestore's 500-writes
    per batch limit)
  - one BigQuery streaming insert, chunked into batches of up to 500 rows.

There is deliberately no free-running background task doing the flush on a
timer: Cloud Run only guarantees CPU is allocated while a request is being
handled (this service runs with the default `cpu_idle=true` + `min_instances
= 0` so it can scale to zero between polls -- see infra/terraform/cloud_run.tf
and the cost discussion in README.md). A timer task sleeping between requests
would get frozen mid-sleep once the instance is throttled/scaled down and
could silently lose buffered heartbeats. Instead, flushing is opportunistic
and request-driven:
  - every `enqueue()` call checks whether `flush_interval` has elapsed since
    the last flush and, if so, awaits `flush_once()` inline (safe: the
    request handler has CPU allocated for its whole duration regardless of
    cpu_idle);
  - a Cloud Scheduler job hits POST /jobs/flush-heartbeats every minute as a
    safety net, guaranteeing a bounded staleness even during a lull in
    device traffic.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from app.bigquery_client import BigQueryClient
from app.cache import PlaylistCache
from app.config import get_settings
from app.firestore_repo import FirestoreRepo
from app.utils import now_utc_iso

logger = logging.getLogger("signage.heartbeat")
settings = get_settings()


@dataclass
class PendingHeartbeat:
    deviceId: str
    appVersion: Optional[str]
    itemActual: Optional[str]
    uptime: Optional[float]
    ultimoError: Optional[str]
    screenWidth: Optional[int]
    screenHeight: Optional[int]
    ts: str = field(default_factory=now_utc_iso)


class HeartbeatBuffer:
    def __init__(
        self,
        repo: FirestoreRepo,
        bq: BigQueryClient,
        cache: PlaylistCache,
        flush_interval: int = 15,
    ):
        self._repo = repo
        self._bq = bq
        self._cache = cache
        self._flush_interval = flush_interval
        self._buffer: list[PendingHeartbeat] = []
        self._lock = asyncio.Lock()
        self._last_flush = time.monotonic()

    async def enqueue(self, hb: PendingHeartbeat) -> None:
        async with self._lock:
            self._buffer.append(hb)
        if time.monotonic() - self._last_flush >= self._flush_interval:
            try:
                await self.flush_once()
            except Exception:
                logger.exception("Opportunistic heartbeat flush failed")

    async def _drain(self) -> list[PendingHeartbeat]:
        async with self._lock:
            drained, self._buffer = self._buffer, []
        return drained

    async def flush_once(self) -> int:
        self._last_flush = time.monotonic()
        batch = await self._drain()
        if not batch:
            return 0

        # 1) Firestore: latest-known-state merge per device (last write wins
        #    within this flush window) + one history doc per heartbeat.
        latest_by_device: dict[str, dict] = {}
        for hb in batch:
            resolucion = (
                f"{hb.screenWidth}x{hb.screenHeight}"
                if hb.screenWidth and hb.screenHeight
                else None
            )
            update = {
                "lastSeen": hb.ts,
                "online": True,
                "itemActual": hb.itemActual,
                "appVersion": hb.appVersion,
                "ultimoError": hb.ultimoError,
            }
            if resolucion:
                update["resolucion"] = resolucion
            latest_by_device[hb.deviceId] = update

        try:
            await self._repo.batch_update_devices(latest_by_device)
        except Exception:
            logger.exception("Failed to flush heartbeat state to Firestore")

        for hb in batch:
            try:
                await self._repo.stream_heartbeat(
                    hb.deviceId,
                    {
                        "ts": hb.ts,
                        "appVersion": hb.appVersion,
                        "itemActual": hb.itemActual,
                        "uptime": hb.uptime,
                        "ultimoError": hb.ultimoError,
                    },
                )
            except Exception:
                logger.exception("Failed to write heartbeat history doc for %s", hb.deviceId)

        # 2) BigQuery: append-only historical rows, chunked internally into
        #    batches of up to 500 by BigQueryClient.
        rows = [
            {
                "ts": hb.ts,
                "deviceId": hb.deviceId,
                "groupId": None,  # enriched later by hourly snapshot join if needed
                "itemActual": hb.itemActual,
                "appVersion": hb.appVersion,
                "uptimeSec": hb.uptime,
                "ultimoError": hb.ultimoError,
                "online": True,
            }
            for hb in batch
        ]
        try:
            self._bq.insert_heartbeats(rows)
        except Exception:
            logger.exception("Failed to stream heartbeats into BigQuery")

        return len(batch)

    async def stop(self) -> None:
        """Best-effort final flush, called from the FastAPI shutdown handler
        (meaningful for graceful termination / local dev; on a hard Cloud Run
        scale-down there is no shutdown hook guarantee, which is exactly why
        the opportunistic per-request flush and the /jobs/flush-heartbeats
        scheduler safety net exist above)."""
        await self.flush_once()
