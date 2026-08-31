"""
In-process TTL cache for resolved /playlist payloads.

Design goals (per spec):
- Keyed by (groupId, deviceId) so a group-wide invalidation (e.g. a group's
  playlist changed) can drop every device in that group in O(devices in group)
  without touching Firestore.
- TTL of 60s as a safety net.
- Zero Firestore reads on a cache hit -- we never re-check a "version" pointer
  against Firestore on read. Instead, admin write-paths call `invalidate_*`
  explicitly the moment they mutate a playlist/group/device, so the cache is
  correct *and* cheap: a hit is a pure dict lookup.
- Per Cloud Run container: this is process-local. With min-instances=1 and
  concurrency=80 this still gives a very high hit rate; with more containers
  each just has its own warm cache, which is an acceptable tradeoff for a
  read-mostly, ~100 device workload.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from threading import RLock
from typing import Optional


@dataclass
class _Entry:
    payload: dict
    etag: str
    expires_at: float


class PlaylistCache:
    def __init__(self, ttl_seconds: int = 60):
        self._ttl = ttl_seconds
        self._lock = RLock()
        self._by_device: dict[str, _Entry] = {}
        # reverse index: groupId -> set of deviceIds currently cached, so a
        # group-level playlist change invalidates only affected devices.
        self._group_index: dict[str, set[str]] = {}

    def get(self, device_id: str) -> Optional[tuple[dict, str]]:
        with self._lock:
            entry = self._by_device.get(device_id)
            if entry is None:
                return None
            if entry.expires_at < time.monotonic():
                self._by_device.pop(device_id, None)
                return None
            return entry.payload, entry.etag

    def set(self, device_id: str, group_id: Optional[str], payload: dict, etag: str) -> None:
        with self._lock:
            self._by_device[device_id] = _Entry(
                payload=payload,
                etag=etag,
                expires_at=time.monotonic() + self._ttl,
            )
            if group_id:
                self._group_index.setdefault(group_id, set()).add(device_id)

    def invalidate_device(self, device_id: str) -> None:
        with self._lock:
            self._by_device.pop(device_id, None)

    def invalidate_group(self, group_id: str) -> None:
        with self._lock:
            device_ids = self._group_index.pop(group_id, set())
            for device_id in device_ids:
                self._by_device.pop(device_id, None)

    def invalidate_all(self) -> None:
        with self._lock:
            self._by_device.clear()
            self._group_index.clear()


# Process-wide singleton (one per Cloud Run container).
playlist_cache = PlaylistCache()
