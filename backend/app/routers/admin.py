"""
Admin panel API. Every route requires a valid Firebase ID token whose email
is in the server-side allow-list (see app.deps.get_current_admin). None of
these routes are reachable by the Android TV devices.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import bigquery

from app.bigquery_client import BigQueryClient, get_bigquery_client
from app.cache import playlist_cache
from app.config import get_settings
from app.deps import AdminUser, get_current_admin
from app.firestore_repo import FirestoreRepo, get_repo
from app.gcs_client import GcsClient, get_gcs_client
from app.schemas import (
    AssetCreateRequest,
    AssetModel,
    AvailabilityByGroupRow,
    BulkCommandRequest,
    CommandRequest,
    DeviceAdminView,
    ErrorRow,
    GroupCreateRequest,
    GroupModel,
    GroupUpdateRequest,
    OverlayRequest,
    PairDeviceRequest,
    PairDeviceResponse,
    PlaylistCreateRequest,
    PlaylistModel,
    PlaylistUpdateRequest,
    ProofOfPlayRow,
    ReassignGroupRequest,
    SetDisabledRequest,
    SetPlaylistOverrideRequest,
    SignedUploadRequest,
    SignedUploadResponse,
    UptimeReportRow,
)
from app.utils import now_utc_iso

settings = get_settings()
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


def _device_to_admin_view(d: dict) -> DeviceAdminView:
    return DeviceAdminView(
        deviceId=d["deviceId"],
        nombre=d.get("nombre"),
        groupId=d.get("groupId"),
        estado=d.get("estado", "pendiente"),
        itemActual=d.get("itemActual"),
        lastSeen=d.get("lastSeen"),
        appVersion=d.get("appVersion"),
        resolucion=d.get("resolucion"),
        ubicacion=d.get("ubicacion"),
        pairingCode=d.get("pairingCode"),
        commandId=d.get("commandId"),
        command=d.get("command"),
        overlay=d.get("overlay"),
        pollMinutes=d.get("pollMinutes"),
        muteVideo=d.get("muteVideo"),
        ultimoError=d.get("ultimoError"),
        playlistOverrideId=d.get("playlistOverrideId"),
        online=d.get("online"),
    )


# --------------------------------------------------------------------------
# Devices
# --------------------------------------------------------------------------
@router.get("/devices", response_model=list[DeviceAdminView])
async def list_devices(
    groupId: Optional[str] = None,
    estado: Optional[str] = None,
    limit: int = Query(default=200, le=1000),
    offset: int = 0,
    repo: FirestoreRepo = Depends(get_repo),
):
    devices = await repo.list_devices(group_id=groupId, estado=estado, limit=limit, offset=offset)
    return [_device_to_admin_view(d) for d in devices]


@router.get("/devices/{device_id}", response_model=DeviceAdminView)
async def get_device(device_id: str, repo: FirestoreRepo = Depends(get_repo)):
    device = await repo.get_device(device_id)
    if not device:
        raise HTTPException(404, "Device not found")
    return _device_to_admin_view(device)


@router.post("/pairing", response_model=PairDeviceResponse)
async def pair_device(body: PairDeviceRequest, repo: FirestoreRepo = Depends(get_repo)):
    device = await repo.pair_device(body.pairingCode, body.nombre, body.groupId)
    if not device:
        raise HTTPException(404, "No pending device found for that pairing code")
    playlist_cache.invalidate_device(device["deviceId"])
    return PairDeviceResponse(
        deviceId=device["deviceId"],
        deviceKey=device["deviceKey"],
        nombre=device["nombre"],
        groupId=device["groupId"],
    )


@router.post("/devices/{device_id}/command")
async def send_command(
    device_id: str, body: CommandRequest, repo: FirestoreRepo = Depends(get_repo)
):
    command_id = f"c-{uuid.uuid4().hex[:8]}"
    await repo.update_device(device_id, {"command": body.command, "commandId": command_id})
    playlist_cache.invalidate_device(device_id)
    return {"deviceId": device_id, "command": body.command, "commandId": command_id}


@router.post("/devices/bulk-command")
async def bulk_command(body: BulkCommandRequest, repo: FirestoreRepo = Depends(get_repo)):
    if not body.deviceIds and not body.groupId:
        raise HTTPException(400, "Provide deviceIds or groupId")
    device_ids = body.deviceIds or [
        d["deviceId"] for d in await repo.list_devices(group_id=body.groupId, limit=10_000)
    ]
    command_id = f"c-{uuid.uuid4().hex[:8]}"
    updates = {
        did: {"command": body.command, "commandId": command_id} for did in device_ids
    }
    await repo.batch_update_devices(updates)
    for did in device_ids:
        playlist_cache.invalidate_device(did)
    return {"affected": device_ids, "command": body.command, "commandId": command_id}


@router.post("/devices/{device_id}/overlay")
async def set_overlay(
    device_id: str, body: OverlayRequest, repo: FirestoreRepo = Depends(get_repo)
):
    await repo.update_device(
        device_id, {"overlay": {"text": body.text, "enabled": body.enabled}}
    )
    playlist_cache.invalidate_device(device_id)
    return {"deviceId": device_id, "overlay": body}


@router.post("/devices/{device_id}/reassign-group")
async def reassign_group(
    device_id: str, body: ReassignGroupRequest, repo: FirestoreRepo = Depends(get_repo)
):
    await repo.update_device(device_id, {"groupId": body.groupId})
    playlist_cache.invalidate_device(device_id)
    return {"deviceId": device_id, "groupId": body.groupId}


@router.post("/devices/{device_id}/disable")
async def set_disabled(
    device_id: str, body: SetDisabledRequest, repo: FirestoreRepo = Depends(get_repo)
):
    estado = "deshabilitado" if body.disabled else "activo"
    await repo.update_device(device_id, {"estado": estado})
    playlist_cache.invalidate_device(device_id)
    return {"deviceId": device_id, "estado": estado}


@router.post("/devices/{device_id}/playlist-override")
async def set_playlist_override(
    device_id: str, body: SetPlaylistOverrideRequest, repo: FirestoreRepo = Depends(get_repo)
):
    await repo.update_device(device_id, {"playlistOverrideId": body.playlistId})
    playlist_cache.invalidate_device(device_id)
    return {"deviceId": device_id, "playlistOverrideId": body.playlistId}


# --------------------------------------------------------------------------
# Groups
# --------------------------------------------------------------------------
@router.get("/groups", response_model=list[GroupModel])
async def list_groups(repo: FirestoreRepo = Depends(get_repo)):
    return await repo.list_groups()


@router.post("/groups", response_model=GroupModel)
async def create_group(body: GroupCreateRequest, repo: FirestoreRepo = Depends(get_repo)):
    group_id = body.nombre.strip().lower().replace(" ", "-")
    fields = {
        "nombre": body.nombre,
        "descripcion": body.descripcion,
        "settings": body.settings.model_dump(),
        "playlistId": body.playlistId,
    }
    return await repo.create_group(group_id, fields)


@router.put("/groups/{group_id}", response_model=GroupModel)
async def update_group(
    group_id: str, body: GroupUpdateRequest, repo: FirestoreRepo = Depends(get_repo)
):
    existing = await repo.get_group(group_id)
    if not existing:
        raise HTTPException(404, "Group not found")
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if "settings" in fields and fields["settings"] is not None:
        fields["settings"] = body.settings.model_dump()
    await repo.update_group(group_id, fields)
    playlist_cache.invalidate_group(group_id)
    return await repo.get_group(group_id)


@router.delete("/groups/{group_id}")
async def delete_group(group_id: str, repo: FirestoreRepo = Depends(get_repo)):
    await repo.delete_group(group_id)
    playlist_cache.invalidate_group(group_id)
    return {"deleted": group_id}


# --------------------------------------------------------------------------
# Playlists
# --------------------------------------------------------------------------
def _invalidate_playlist_consumers(repo_devices: list[dict]) -> None:
    for d in repo_devices:
        playlist_cache.invalidate_device(d["deviceId"])


@router.get("/playlists", response_model=list[PlaylistModel])
async def list_playlists(repo: FirestoreRepo = Depends(get_repo)):
    return await repo.list_playlists()


@router.get("/playlists/{playlist_id}", response_model=PlaylistModel)
async def get_playlist(playlist_id: str, repo: FirestoreRepo = Depends(get_repo)):
    playlist = await repo.get_playlist(playlist_id)
    if not playlist:
        raise HTTPException(404, "Playlist not found")
    return playlist


@router.post("/playlists", response_model=PlaylistModel)
async def create_playlist(body: PlaylistCreateRequest, repo: FirestoreRepo = Depends(get_repo)):
    playlist_id = f"pl-{uuid.uuid4().hex[:10]}"
    fields = {
        "nombre": body.nombre,
        "updatedAt": now_utc_iso(),
        "items": [item.model_dump() for item in body.items],
    }
    return await repo.create_playlist(playlist_id, fields)


@router.put("/playlists/{playlist_id}", response_model=PlaylistModel)
async def update_playlist(
    playlist_id: str,
    body: PlaylistUpdateRequest,
    repo: FirestoreRepo = Depends(get_repo),
):
    existing = await repo.get_playlist(playlist_id)
    if not existing:
        raise HTTPException(404, "Playlist not found")
    fields: dict = {"updatedAt": now_utc_iso()}
    if body.nombre is not None:
        fields["nombre"] = body.nombre
    if body.items is not None:
        fields["items"] = [item.model_dump() for item in body.items]
    await repo.update_playlist(playlist_id, fields)

    # Invalidate every device that resolves to this playlist: direct
    # overrides, group-linked, or (if this is the default) everyone else.
    all_devices = await repo.list_devices(limit=10_000)
    all_groups = await repo.list_groups()
    group_ids_using = {g["groupId"] for g in all_groups if g.get("playlistId") == playlist_id}
    affected = [
        d
        for d in all_devices
        if d.get("playlistOverrideId") == playlist_id
        or d.get("groupId") in group_ids_using
        or (playlist_id == "default" and not d.get("playlistOverrideId") and not d.get("groupId"))
    ]
    _invalidate_playlist_consumers(affected)
    return await repo.get_playlist(playlist_id)


@router.delete("/playlists/{playlist_id}")
async def delete_playlist(playlist_id: str, repo: FirestoreRepo = Depends(get_repo)):
    await repo.delete_playlist(playlist_id)
    playlist_cache.invalidate_all()
    return {"deleted": playlist_id}


# --------------------------------------------------------------------------
# Assets
# --------------------------------------------------------------------------
@router.post("/assets/signed-upload-url", response_model=SignedUploadResponse)
async def signed_upload_url(
    body: SignedUploadRequest, gcs: GcsClient = Depends(get_gcs_client)
):
    upload_url, gcs_path, cdn_url = gcs.build_signed_upload_url(body.filename, body.contentType)
    return SignedUploadResponse(
        uploadUrl=upload_url,
        gcsPath=gcs_path,
        cdnUrl=cdn_url,
        headers={"Content-Type": body.contentType},
    )


@router.post("/assets", response_model=AssetModel)
async def create_asset(body: AssetCreateRequest, repo: FirestoreRepo = Depends(get_repo)):
    asset_id = f"a-{uuid.uuid4().hex[:10]}"
    fields = {
        "nombre": body.nombre,
        "tipo": body.tipo,
        "gcsPath": body.gcsPath,
        "cdnUrl": body.cdnUrl,
        "bytes": body.bytes,
        "duracionSec": body.duracionSec,
        "thumbnailUrl": body.thumbnailUrl,
        "createdAt": now_utc_iso(),
    }
    return await repo.create_asset(asset_id, fields)


@router.get("/assets", response_model=list[AssetModel])
async def list_assets(search: Optional[str] = None, repo: FirestoreRepo = Depends(get_repo)):
    return await repo.list_assets(search=search)


# --------------------------------------------------------------------------
# Reports (query BigQuery views -- see infra/bigquery/views.sql)
# --------------------------------------------------------------------------
@router.get("/reports/uptime", response_model=list[UptimeReportRow])
async def report_uptime(
    days: int = Query(default=7, le=90),
    groupId: Optional[str] = None,
    deviceId: Optional[str] = None,
    bq: BigQueryClient = Depends(get_bigquery_client),
):
    sql = f"""
        SELECT fecha, deviceId, nombre, groupId, uptimePct
        FROM `{settings.gcp_project}.{settings.bq_dataset}.v_uptime_diario_por_dispositivo`
        WHERE fecha >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
          AND (@groupId IS NULL OR groupId = @groupId)
          AND (@deviceId IS NULL OR deviceId = @deviceId)
        ORDER BY fecha DESC, deviceId
    """
    params = [
        bigquery.ScalarQueryParameter("days", "INT64", days),
        bigquery.ScalarQueryParameter("groupId", "STRING", groupId),
        bigquery.ScalarQueryParameter("deviceId", "STRING", deviceId),
    ]
    return bq.query(sql, params)


@router.get("/reports/availability-by-group", response_model=list[AvailabilityByGroupRow])
async def report_availability_by_group(
    days: int = Query(default=7, le=90), bq: BigQueryClient = Depends(get_bigquery_client)
):
    sql = f"""
        SELECT groupId, fecha, dispositivosTotal, dispositivosOnline, disponibilidadPct
        FROM `{settings.gcp_project}.{settings.bq_dataset}.v_disponibilidad_por_grupo`
        WHERE fecha >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
        ORDER BY fecha DESC, groupId
    """
    params = [bigquery.ScalarQueryParameter("days", "INT64", days)]
    return bq.query(sql, params)


@router.get("/reports/errors", response_model=list[ErrorRow])
async def report_errors(
    hours: int = Query(default=24, le=168), bq: BigQueryClient = Depends(get_bigquery_client)
):
    sql = f"""
        SELECT itemId, url, tipo, errores
        FROM `{settings.gcp_project}.{settings.bq_dataset}.v_items_con_mas_errores`
        WHERE ventanaHoras = @hours OR @hours IS NULL
        ORDER BY errores DESC
        LIMIT 50
    """
    params = [bigquery.ScalarQueryParameter("hours", "INT64", hours)]
    return bq.query(sql, params)


@router.get("/reports/proof-of-play", response_model=list[ProofOfPlayRow])
async def report_proof_of_play(
    deviceId: Optional[str] = None,
    days: int = Query(default=1, le=30),
    bq: BigQueryClient = Depends(get_bigquery_client),
):
    sql = f"""
        SELECT ts, deviceId, itemId, tipo, url, durationSec, resultado
        FROM `{settings.gcp_project}.{settings.bq_dataset}.v_proof_of_play`
        WHERE DATE(ts) >= DATE_SUB(CURRENT_DATE(), INTERVAL @days DAY)
          AND (@deviceId IS NULL OR deviceId = @deviceId)
        ORDER BY ts DESC
        LIMIT 5000
    """
    params = [
        bigquery.ScalarQueryParameter("days", "INT64", days),
        bigquery.ScalarQueryParameter("deviceId", "STRING", deviceId),
    ]
    return bq.query(sql, params)


@router.get("/whoami")
async def whoami(admin: AdminUser = Depends(get_current_admin)):
    return {"uid": admin.uid, "email": admin.email}


# --------------------------------------------------------------------------
# Dashboard summary
# --------------------------------------------------------------------------
@router.get("/dashboard/summary")
async def dashboard_summary(
    repo: FirestoreRepo = Depends(get_repo), bq: BigQueryClient = Depends(get_bigquery_client)
):
    devices = await repo.list_devices(limit=10_000)
    total = len(devices)
    online = sum(1 for d in devices if d.get("online") and d.get("estado") == "activo")
    offline = sum(1 for d in devices if d.get("estado") == "activo" and not d.get("online"))
    pendiente = sum(1 for d in devices if d.get("estado") == "pendiente")
    deshabilitado = sum(1 for d in devices if d.get("estado") == "deshabilitado")
    by_location = [
        {
            "deviceId": d["deviceId"],
            "nombre": d.get("nombre"),
            "ubicacion": d.get("ubicacion"),
            "online": d.get("online"),
            "estado": d.get("estado"),
        }
        for d in devices
    ]
    try:
        top_errors = await report_errors(hours=24, bq=bq)
    except Exception:
        top_errors = []
    return {
        "total": total,
        "online": online,
        "offline": offline,
        "pendiente": pendiente,
        "deshabilitado": deshabilitado,
        "devicesByLocation": by_location,
        "topErrorsLast24h": top_errors,
    }
