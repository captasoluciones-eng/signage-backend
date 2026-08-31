"""
Device-facing endpoints consumed by the existing Android TV app. The JSON
shapes here are a fixed contract -- do not rename/remove fields.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, Request, Response, status

from app.deps import DeviceContext, get_device_context
from app.firestore_repo import FirestoreRepo, get_repo
from app.heartbeat_buffer import PendingHeartbeat
from app.playlist_service import get_playlist_cached
from app.schemas import HeartbeatRequest, RegisterRequest, RegisterResponse

logger = logging.getLogger("signage.device")
router = APIRouter(tags=["device"])


@router.post("/register", response_model=RegisterResponse)
async def register_device(
    body: RegisterRequest, repo: FirestoreRepo = Depends(get_repo)
) -> RegisterResponse:
    device, created = await repo.create_device_if_absent(
        body.deviceId, body.screenWidth, body.screenHeight
    )
    return RegisterResponse(
        deviceId=device["deviceId"],
        estado=device["estado"],
        pairingCode=device.get("pairingCode"),
        created=created,
    )


@router.get("/playlist")
async def get_playlist(
    request: Request,
    response: Response,
    deviceId: str,
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    ctx: DeviceContext = Depends(get_device_context),
    repo: FirestoreRepo = Depends(get_repo),
):
    payload, etag = await get_playlist_cached(repo, deviceId, ctx.device)

    response.headers["Cache-Control"] = "private, max-age=60"
    response.headers["ETag"] = etag

    if if_none_match and if_none_match == etag:
        response.status_code = status.HTTP_304_NOT_MODIFIED
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=dict(response.headers))

    return payload


@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
async def heartbeat(body: HeartbeatRequest, request: Request) -> Response:
    buffer = request.app.state.heartbeat_buffer
    await buffer.enqueue(
        PendingHeartbeat(
            deviceId=body.deviceId,
            appVersion=body.appVersion,
            itemActual=body.itemActual,
            uptime=body.uptime,
            ultimoError=body.ultimoError,
            screenWidth=body.screenWidth,
            screenHeight=body.screenHeight,
        )
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
