"""
Firestore repository layer. All Firestore access goes through this module so
routers stay thin and testable, and so the collection/field names in the data
model live in exactly one place.

Uses the async Firestore client (google.cloud.firestore.AsyncClient) since the
whole app is built on FastAPI's async request path.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from google.cloud import firestore

from app.config import get_settings
from app.utils import generate_device_key, generate_pairing_code, now_utc_iso

settings = get_settings()

COL_DEVICES = "devices"
COL_GROUPS = "groups"
COL_PLAYLISTS = "playlists"
COL_ASSETS = "assets"
SUBCOL_HEARTBEATS = "heartbeats"


class FirestoreRepo:
    def __init__(self, client: Optional[firestore.AsyncClient] = None):
        self._client = client or firestore.AsyncClient(
            project=settings.gcp_project, database=settings.firestore_database
        )

    @property
    def client(self) -> firestore.AsyncClient:
        return self._client

    # ------------------------------------------------------------------
    # Devices
    # ------------------------------------------------------------------
    async def get_device(self, device_id: str) -> Optional[dict]:
        snap = await self._client.collection(COL_DEVICES).document(device_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        data["deviceId"] = snap.id
        return data

    async def create_device_if_absent(
        self, device_id: str, screen_width: Optional[int], screen_height: Optional[int]
    ) -> tuple[dict, bool]:
        """Idempotent /register. Returns (device_dict, created_bool)."""
        doc_ref = self._client.collection(COL_DEVICES).document(device_id)

        @firestore.async_transactional
        async def txn_fn(transaction: firestore.AsyncTransaction):
            snap = await doc_ref.get(transaction=transaction)
            if snap.exists:
                data = snap.to_dict() or {}
                data["deviceId"] = snap.id
                return data, False
            resolucion = (
                f"{screen_width}x{screen_height}" if screen_width and screen_height else None
            )
            new_doc = {
                "nombre": None,
                "groupId": None,
                "estado": "pendiente",
                "deviceKey": None,
                "pairingCode": generate_pairing_code(),
                "pollMinutes": 5,
                "muteVideo": True,
                "commandId": None,
                "command": "none",
                "overlay": {"text": "", "enabled": False},
                "ubicacion": None,
                "createdAt": now_utc_iso(),
                "lastSeen": None,
                "appVersion": None,
                "itemActual": None,
                "ultimoError": None,
                "resolucion": resolucion,
                "playlistOverrideId": None,
            }
            transaction.set(doc_ref, new_doc)
            new_doc["deviceId"] = device_id
            return new_doc, True

        transaction = self._client.transaction()
        return await txn_fn(transaction)

    async def update_device(self, device_id: str, fields: dict[str, Any]) -> None:
        await self._client.collection(COL_DEVICES).document(device_id).set(
            fields, merge=True
        )

    async def list_devices(
        self,
        group_id: Optional[str] = None,
        estado: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[dict]:
        query = self._client.collection(COL_DEVICES)
        if group_id:
            query = query.where("groupId", "==", group_id)
        if estado:
            query = query.where("estado", "==", estado)
        docs = query.stream()
        results = []
        async for snap in docs:
            data = snap.to_dict() or {}
            data["deviceId"] = snap.id
            results.append(data)
        results.sort(key=lambda d: d.get("nombre") or d.get("deviceId") or "")
        return results[offset : offset + limit]

    async def pair_device(
        self, pairing_code: str, nombre: str, group_id: str
    ) -> Optional[dict]:
        """Finds the pending device with this pairing code and activates it,
        issuing a fresh deviceKey. Returns the updated device dict, or None if
        no pending device matches the code.
        """
        query = (
            self._client.collection(COL_DEVICES)
            .where("pairingCode", "==", pairing_code)
            .where("estado", "==", "pendiente")
            .limit(1)
        )
        found = None
        async for snap in query.stream():
            found = snap
            break
        if found is None:
            return None
        device_key = generate_device_key()
        update = {
            "nombre": nombre,
            "groupId": group_id,
            "estado": "activo",
            "deviceKey": device_key,
        }
        await found.reference.set(update, merge=True)
        data = found.to_dict() or {}
        data.update(update)
        data["deviceId"] = found.id
        return data

    async def batch_update_devices(self, updates: dict[str, dict[str, Any]]) -> None:
        """updates: {deviceId: {field: value, ...}}"""
        batch = self._client.batch()
        for device_id, fields in updates.items():
            ref = self._client.collection(COL_DEVICES).document(device_id)
            batch.set(ref, fields, merge=True)
        await batch.commit()

    async def stream_heartbeat(self, device_id: str, fields: dict[str, Any]) -> None:
        """Writes one heartbeat doc into the device's heartbeats subcollection
        (used for short-term operational history; purged after 7 days). The
        caller is expected to batch these -- see heartbeat_buffer.py.
        """
        ref = (
            self._client.collection(COL_DEVICES)
            .document(device_id)
            .collection(SUBCOL_HEARTBEATS)
            .document()
        )
        await ref.set(fields)

    async def purge_old_heartbeats(self, older_than_days: int) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
        deleted = 0
        devices = self._client.collection(COL_DEVICES).stream()
        async for device_snap in devices:
            hb_query = (
                device_snap.reference.collection(SUBCOL_HEARTBEATS)
                .where("ts", "<", cutoff.isoformat())
                .limit(500)
            )
            while True:
                batch = self._client.batch()
                count = 0
                async for hb_snap in hb_query.stream():
                    batch.delete(hb_snap.reference)
                    count += 1
                if count == 0:
                    break
                await batch.commit()
                deleted += count
                if count < 500:
                    break
        return deleted

    async def mark_stale_devices_offline(self, threshold_minutes: int) -> list[str]:
        """Returns deviceIds transitioned from "seen recently" to "offline"
        (i.e. lastSeen older than threshold and not already flagged offline).
        Online/offline is derived, not stored as `estado` (estado stays
        pendiente/activo/deshabilitado); we store a boolean `online` flag used
        by the dashboard and the alert hook.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=threshold_minutes)
        cutoff_iso = cutoff.isoformat()
        newly_offline: list[str] = []
        query = self._client.collection(COL_DEVICES).where("estado", "==", "activo")
        batch = self._client.batch()
        pending = 0
        async for snap in query.stream():
            data = snap.to_dict() or {}
            last_seen = data.get("lastSeen")
            was_online = data.get("online", True)
            is_stale = (last_seen is None) or (last_seen < cutoff_iso)
            if is_stale and was_online:
                batch.set(snap.reference, {"online": False}, merge=True)
                newly_offline.append(snap.id)
                pending += 1
                if pending >= 400:
                    await batch.commit()
                    batch = self._client.batch()
                    pending = 0
        if pending:
            await batch.commit()
        return newly_offline

    # ------------------------------------------------------------------
    # Groups
    # ------------------------------------------------------------------
    async def get_group(self, group_id: str) -> Optional[dict]:
        snap = await self._client.collection(COL_GROUPS).document(group_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        data["groupId"] = snap.id
        return data

    async def list_groups(self) -> list[dict]:
        results = []
        async for snap in self._client.collection(COL_GROUPS).stream():
            data = snap.to_dict() or {}
            data["groupId"] = snap.id
            results.append(data)
        return results

    async def create_group(self, group_id: str, fields: dict[str, Any]) -> dict:
        await self._client.collection(COL_GROUPS).document(group_id).set(fields)
        fields = dict(fields)
        fields["groupId"] = group_id
        return fields

    async def update_group(self, group_id: str, fields: dict[str, Any]) -> None:
        await self._client.collection(COL_GROUPS).document(group_id).set(
            fields, merge=True
        )

    async def delete_group(self, group_id: str) -> None:
        await self._client.collection(COL_GROUPS).document(group_id).delete()

    # ------------------------------------------------------------------
    # Playlists
    # ------------------------------------------------------------------
    async def get_playlist(self, playlist_id: str) -> Optional[dict]:
        snap = await self._client.collection(COL_PLAYLISTS).document(playlist_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        data["playlistId"] = snap.id
        return data

    async def list_playlists(self) -> list[dict]:
        results = []
        async for snap in self._client.collection(COL_PLAYLISTS).stream():
            data = snap.to_dict() or {}
            data["playlistId"] = snap.id
            results.append(data)
        return results

    async def create_playlist(self, playlist_id: str, fields: dict[str, Any]) -> dict:
        await self._client.collection(COL_PLAYLISTS).document(playlist_id).set(fields)
        fields = dict(fields)
        fields["playlistId"] = playlist_id
        return fields

    async def update_playlist(self, playlist_id: str, fields: dict[str, Any]) -> None:
        await self._client.collection(COL_PLAYLISTS).document(playlist_id).set(
            fields, merge=True
        )

    async def delete_playlist(self, playlist_id: str) -> None:
        await self._client.collection(COL_PLAYLISTS).document(playlist_id).delete()

    # ------------------------------------------------------------------
    # Assets
    # ------------------------------------------------------------------
    async def create_asset(self, asset_id: str, fields: dict[str, Any]) -> dict:
        await self._client.collection(COL_ASSETS).document(asset_id).set(fields)
        fields = dict(fields)
        fields["assetId"] = asset_id
        return fields

    async def list_assets(self, search: Optional[str] = None) -> list[dict]:
        results = []
        async for snap in self._client.collection(COL_ASSETS).stream():
            data = snap.to_dict() or {}
            data["assetId"] = snap.id
            if search and search.lower() not in (data.get("nombre") or "").lower():
                continue
            results.append(data)
        return results


# Process-wide singleton, reused across requests within a container.
_repo_singleton: Optional[FirestoreRepo] = None


def get_repo() -> FirestoreRepo:
    global _repo_singleton
    if _repo_singleton is None:
        _repo_singleton = FirestoreRepo()
    return _repo_singleton
