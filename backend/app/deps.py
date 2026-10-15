"""
FastAPI dependencies: device-key auth, Firebase ID token + email allow-list
auth for the admin panel, and Cloud Scheduler OIDC verification for the
job-trigger endpoints.
"""
from __future__ import annotations

import hmac
import logging
from typing import Optional

import firebase_admin
from fastapi import Depends, Header, HTTPException, Request, status
from firebase_admin import auth as firebase_auth
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.config import get_settings
from app.firestore_repo import FirestoreRepo, get_repo

logger = logging.getLogger("signage.auth")
settings = get_settings()

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={"projectId": settings.firebase_project_id})

_google_auth_request = google_requests.Request()


# --------------------------------------------------------------------------
# Device-facing auth: X-Device-Key
# --------------------------------------------------------------------------
class DeviceContext:
    """Represents the calling device's resolved state.

    `device` is None when the deviceId has never called /register -- callers
    (the /playlist handler) must treat that as "pending, no items, no error"
    per the contract, NOT as a 404/401.
    """

    def __init__(self, device_id: str, device: Optional[dict]):
        self.device_id = device_id
        self.device = device

    @property
    def is_paired(self) -> bool:
        return bool(self.device) and self.device.get("estado") == "activo"

    @property
    def is_disabled(self) -> bool:
        return bool(self.device) and self.device.get("estado") == "deshabilitado"


async def get_device_context(
    deviceId: str,
    x_device_key: Optional[str] = Header(default=None, alias="X-Device-Key"),
    repo: FirestoreRepo = Depends(get_repo),
) -> DeviceContext:
    device = await repo.get_device(deviceId)

    if device is None:
        # Unpaired/unknown device: /register and /playlist are allowed with
        # no key; /playlist will resolve to items: [] downstream.
        return DeviceContext(deviceId, None)

    if device.get("estado") == "activo":
        expected_key = device.get("deviceKey")
        if not expected_key or x_device_key != expected_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing X-Device-Key for a paired device.",
            )

    return DeviceContext(deviceId, device)


# --------------------------------------------------------------------------
# Admin panel auth: Firebase ID token + roles
#   - Correos de ADMIN_EMAIL_ALLOWLIST: administradores siempre (como antes).
#   - Colección panel_users: los que da de alta un admin en "Usuarios", con
#     rol admin / rh / lectura. Pueden entrar con Google o con correo y
#     contraseña (p. ej. cuentas de Outlook).
# --------------------------------------------------------------------------
ROLES = ("admin", "rh", "lectura")


class PanelUser:
    def __init__(self, uid: str, email: str, rol: str, nombre: str = "", superadmin: bool = False):
        self.uid = uid
        self.email = email
        self.rol = rol
        self.nombre = nombre
        self.superadmin = superadmin


class AdminUser(PanelUser):
    pass


def _decode_bearer(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    id_token = authorization.split(" ", 1)[1].strip()
    try:
        return firebase_auth.verify_id_token(id_token)
    except Exception as exc:  # invalid, expired, wrong audience, etc.
        logger.warning("Firebase ID token verification failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid ID token.")


async def resolve_panel_user(decoded: dict, repo: FirestoreRepo) -> PanelUser:
    """Reglas de acceso, aparte para poder probarlas sin Firebase."""
    email = (decoded.get("email") or "").lower()
    if not email or not decoded.get("email_verified", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cuenta sin correo verificado.")
    if email in settings.admin_email_allowlist_set:
        return PanelUser(decoded.get("uid", ""), email, "admin", decoded.get("name") or "", superadmin=True)
    doc = await repo.get_panel_user(email)
    if not doc or doc.get("activo") is False or doc.get("rol") not in ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not authorized to access the admin panel.",
        )
    return PanelUser(decoded.get("uid", ""), email, doc["rol"], doc.get("nombre") or "")


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    repo: FirestoreRepo = Depends(get_repo),
) -> PanelUser:
    return await resolve_panel_user(_decode_bearer(authorization), repo)


async def get_current_admin(user: PanelUser = Depends(get_current_user)) -> AdminUser:
    if user.rol != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo administradores.")
    return AdminUser(user.uid, user.email, user.rol, user.nombre, user.superadmin)


async def get_rh_user(user: PanelUser = Depends(get_current_user)) -> PanelUser:
    """Publicar / editar contenido de RH: admin o rh."""
    if user.rol not in ("admin", "rh"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tu usuario solo puede ver, no publicar.")
    return user


# --------------------------------------------------------------------------
# Cloud Scheduler -> Cloud Run job endpoints: OIDC bearer token verification
# --------------------------------------------------------------------------
async def verify_scheduler_request(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_scheduler_key: Optional[str] = Header(default=None, alias="X-Scheduler-Key"),
) -> None:
    # Dev/local fallback: a static shared secret (never set this in prod).
    if settings.scheduler_dev_shared_secret:
        if x_scheduler_key == settings.scheduler_dev_shared_secret:
            return
        raise HTTPException(status_code=401, detail="Invalid X-Scheduler-Key.")

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing OIDC bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    audience = str(request.url).split("?")[0]
    try:
        claims = google_id_token.verify_oauth2_token(token, _google_auth_request, audience)
    except Exception as exc:
        logger.warning("Scheduler OIDC verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid OIDC token.")

    if claims.get("email") != settings.scheduler_service_account_email:
        raise HTTPException(
            status_code=403,
            detail="Token was not issued to the signage scheduler service account.",
        )


# --------------------------------------------------------------------------
# Sheet -> playlists automation: static shared secret in X-Sync-Key
# --------------------------------------------------------------------------
async def verify_sync_key(
    x_sync_key: Optional[str] = Header(default=None, alias="X-Sync-Key"),
) -> None:
    if not settings.sync_api_key:
        raise HTTPException(status_code=503, detail="Sync is not configured (SYNC_API_KEY).")
    if not x_sync_key or not hmac.compare_digest(x_sync_key, settings.sync_api_key):
        raise HTTPException(status_code=401, detail="Invalid X-Sync-Key.")
