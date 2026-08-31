"""
Endpoints triggered exclusively by Cloud Scheduler (see infra/terraform for
the three `google_cloud_scheduler_job` resources that call these on a cron).
Authenticated via OIDC bearer token (or a dev shared secret) -- see
app.deps.verify_scheduler_request.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from app.bigquery_client import BigQueryClient, get_bigquery_client
from app.cache import playlist_cache
from app.config import get_settings
from app.deps import verify_scheduler_request
from app.firestore_repo import FirestoreRepo, get_repo
from app.utils import now_utc_iso

logger = logging.getLogger("signage.jobs")
settings = get_settings()

router = APIRouter(
    prefix="/jobs", tags=["jobs"], dependencies=[Depends(verify_scheduler_request)]
)


def notify_devices_offline(device_ids: list[str]) -> None:
    """Extension point: wire this to Slack/PagerDuty/email/etc.

    Kept intentionally simple (structured log line) so ops can attach a
    log-based alert policy in Cloud Monitoring on the "SIGNAGE_ALERT" token
    without redeploying the app; swap the body for a real notification
    integration (e.g. Slack webhook, SendGrid, Pub/Sub topic) when ready.
    """
    if not device_ids:
        return
    logger.warning(
        "SIGNAGE_ALERT devices_offline=%d device_ids=%s", len(device_ids), device_ids
    )


@router.post("/mark-offline-devices")
async def mark_offline_devices(repo: FirestoreRepo = Depends(get_repo)) -> dict:
    """Runs every 5 minutes. Devices whose lastSeen is older than
    OFFLINE_THRESHOLD_MINUTES (default 15) are flagged online=false and an
    alert hook fires.
    """
    newly_offline = await repo.mark_stale_devices_offline(settings.offline_threshold_minutes)
    for device_id in newly_offline:
        playlist_cache.invalidate_device(device_id)
    notify_devices_offline(newly_offline)
    return {"newlyOffline": newly_offline, "count": len(newly_offline)}


@router.post("/snapshot-devices")
async def snapshot_devices(
    repo: FirestoreRepo = Depends(get_repo),
    bq: BigQueryClient = Depends(get_bigquery_client),
) -> dict:
    """Runs hourly. Snapshots the full devices collection into
    BigQuery.device_snapshots for historical trend queries.
    """
    devices = await repo.list_devices(limit=10_000)
    fecha = now_utc_iso()[:10]
    rows = [
        {
            "fecha": fecha,
            "deviceId": d["deviceId"],
            "nombre": d.get("nombre"),
            "groupId": d.get("groupId"),
            "estado": d.get("estado"),
            "lastSeen": d.get("lastSeen"),
            "appVersion": d.get("appVersion"),
        }
        for d in devices
    ]
    bq.insert_device_snapshots(rows)
    return {"snapshotted": len(rows)}


@router.post("/purge-old-heartbeats")
async def purge_old_heartbeats(repo: FirestoreRepo = Depends(get_repo)) -> dict:
    """Runs daily at 03:00. Deletes Firestore heartbeat history docs older
    than HEARTBEAT_RETENTION_DAYS (default 7) -- long-term history already
    lives in BigQuery.heartbeats via the streaming insert path.
    """
    deleted = await repo.purge_old_heartbeats(settings.heartbeat_retention_days)
    return {"deleted": deleted}
