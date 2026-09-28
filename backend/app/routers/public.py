"""
Unauthenticated, read-only endpoints for kiosk displays that aren't part of
the Content Studio / Android TV device system -- e.g. the branch tablero
(Apps Script "Tablero Kiosco" -> tablero_static_gb10.html on the GB10),
which has no Firebase login and calls this server-to-server via UrlFetchApp.

Only low-sensitivity, read-only data belongs here (an event announcement's
title/date/location/photo, nothing a branch visitor couldn't already see on
the wall). Anything else stays under /admin (Firebase-gated) or the
device-key-gated /playlist flow.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from app.firestore_repo import FirestoreRepo, get_repo
from app.schemas import RHAnnouncementModel

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/rh-announcement/{group_id}", response_model=Optional[RHAnnouncementModel])
async def get_public_rh_announcement(group_id: str, repo: FirestoreRepo = Depends(get_repo)):
    ann = await repo.get_rh_announcement(group_id)
    if ann and not ann.get("activo", True):
        return None
    return ann
