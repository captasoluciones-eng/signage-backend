"""
Playlist resolution: per-device override > group playlist > global default.

Resolution order (highest priority first):
  1. devices/{deviceId}.playlistOverrideId
  2. groups/{device.groupId}.playlistId
  3. the well-known global default playlist, id "default"

Items are filtered to activo == true AND vigente "now" in America/Mazatlan,
then sorted by `orden`.
"""
from __future__ import annotations

from typing import Optional

from app.cache import playlist_cache
from app.firestore_repo import FirestoreRepo
from app.schemas import (
    DeviceCommand,
    OverlayModel,
    PlaylistItemModel,
    PlaylistResponse,
    SettingsModel,
)
from app.utils import compute_etag, is_item_vigente, now_utc_iso

GLOBAL_DEFAULT_PLAYLIST_ID = "default"


async def _resolve_playlist_id(repo: FirestoreRepo, device: dict) -> Optional[str]:
    override = device.get("playlistOverrideId")
    if override:
        return override
    group_id = device.get("groupId")
    if group_id:
        group = await repo.get_group(group_id)
        if group and group.get("playlistId"):
            return group["playlistId"]
    return GLOBAL_DEFAULT_PLAYLIST_ID


def _filter_and_sort_items(raw_items: list[dict]) -> list[PlaylistItemModel]:
    items = []
    for it in raw_items:
        if not it.get("activo", True):
            continue
        if not is_item_vigente(it.get("vigenciaDesde"), it.get("vigenciaHasta")):
            continue
        items.append(
            PlaylistItemModel(
                id=it["id"],
                type=it["type"],
                url=it["url"],
                durationSec=it.get("durationSec"),
                scale=it.get("scale"),
                orden=it.get("orden", 0),
                activo=True,
            )
        )
    items.sort(key=lambda i: i.orden)
    return items


async def resolve_playlist_for_device(
    repo: FirestoreRepo, device_id: str, device: Optional[dict]
) -> tuple[PlaylistResponse, str]:
    """Builds the exact client-contract payload for one device. Returns
    (response_model, etag). Caller is responsible for cache get/set.
    """
    if device is None:
        # Unknown / not yet registered: contract says items: [], no error.
        payload = PlaylistResponse(
            version=1,
            updatedAt=now_utc_iso(),
            deviceName="",
            groupId=None,
            commandId=None,
            command=DeviceCommand.none,
            overlay=OverlayModel(),
            settings=SettingsModel(),
            items=[],
        )
        etag = compute_etag(payload.model_dump(mode="json"))
        return payload, etag

    estado = device.get("estado", "pendiente")
    group_id = device.get("groupId")
    group = await repo.get_group(group_id) if group_id else None

    poll_minutes = device.get("pollMinutes") or (group or {}).get("settings", {}).get(
        "pollMinutes", 5
    )
    mute_video = device.get("muteVideo")
    if mute_video is None:
        mute_video = (group or {}).get("settings", {}).get("muteVideo", True)
    transition_ms = (group or {}).get("settings", {}).get("transitionMs", 500)

    overlay_raw = device.get("overlay") or {}
    overlay = OverlayModel(
        text=overlay_raw.get("text", ""), enabled=overlay_raw.get("enabled", False)
    )

    items: list[PlaylistItemModel] = []
    updated_at = now_utc_iso()
    if estado == "activo":
        playlist_id = await _resolve_playlist_id(repo, device)
        playlist = await repo.get_playlist(playlist_id) if playlist_id else None
        if playlist:
            items = _filter_and_sort_items(playlist.get("items", []))
            updated_at = playlist.get("updatedAt", updated_at)
    # pendiente / deshabilitado -> items stays [] per contract.

    payload = PlaylistResponse(
        version=1,
        updatedAt=updated_at,
        deviceName=device.get("nombre") or "",
        groupId=group_id,
        commandId=device.get("commandId"),
        command=device.get("command") or DeviceCommand.none,
        overlay=overlay,
        settings=SettingsModel(
            pollMinutes=poll_minutes, muteVideo=mute_video, transitionMs=transition_ms
        ),
        items=items,
    )
    etag = compute_etag(payload.model_dump(mode="json"))
    return payload, etag


async def get_playlist_cached(
    repo: FirestoreRepo, device_id: str, device: Optional[dict]
) -> tuple[dict, str]:
    """Cache-aware wrapper. Returns (payload_dict, etag)."""
    cached = playlist_cache.get(device_id)
    if cached is not None:
        return cached

    payload, etag = await resolve_playlist_for_device(repo, device_id, device)
    payload_dict = payload.model_dump(mode="json")
    group_id = device.get("groupId") if device else None
    playlist_cache.set(device_id, group_id, payload_dict, etag)
    return payload_dict, etag
