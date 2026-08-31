"""
Non-blocking heartbeat ingestion.

POST /heartbeat must return 204 immediately and never block on Firestore or
BigQuery I/O. We push each heartbeat into an in-memory list guarded by an
asyncio.Lock, and a background task (started on FastAPI startup) flushes the
buffer every `heartbeat_flush_interval_seconds` seconds:
  - one Firestore batched write (latest-state merge into devices/{id}, plus
    one heartbeat history doc per device, subject to Firestore's 500-writes
    per batch limit)
  - one BigQuery streaming insert, chunked into batches of up to 500 rows.
"""
from __future__ import annotations

import asyncio
import logging
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
        self._task: Optional[asyncio.Task] = None

    async def enqueue(self, hb: PendingHeartbeat) -> None:
        async with self._lock:
            self._buffer.append(hb)

    async def _drain(self) -> list[PendingHeartbeat]:
        async with self._lock:
            drained, self._buffer = self._buffer, []
        return drained

    async def flush_once(self) -> int:
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

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(self._flush_interval)
            try:
                n = await self.flush_once()
                if n:
                    logger.info("Flushed %d heartbeats", n)
            except Exception:
                logger.exception("Heartbeat flush loop iteration failed")

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        # Best-effort final flush so we don't lose the tail buffer on shutdown.
        await self.flush_once()
