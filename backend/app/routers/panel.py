"""
Panel: quién soy (/me), sección de Recursos Humanos (/rh/...) y alta de usuarios
del panel con rol (/admin/usuarios).

La sección de RH NO guarda nada en Firestore: publica, lista y edita en el Sheet
"CaptaVision · Contenido de Pantallas" (la fuente de la verdad) a través de su
web app de Apps Script (Panel.gs, doPost), firmando con SYNC_API_KEY. El Sheet
sincroniza al momento y las TVs lo toman como siempre. Los archivos no pasan por
aquí: el navegador los sube directo a Cloud Storage con una URL firmada.
"""
from __future__ import annotations

import logging
import re
import secrets
from urllib.parse import urlencode
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from firebase_admin import auth as firebase_auth

from app.config import get_settings
from app.deps import AdminUser, PanelUser, get_current_admin, get_current_user, get_rh_user
from app.firestore_repo import FirestoreRepo, get_repo
from app.gcs_client import GcsClient, get_gcs_client
from app.routers.sync import fondo_valido
from app.schemas import (
    FondoCreateRequest,
    FondoModel,
    MeResponse,
    PanelUserCreateRequest,
    PanelUserCreateResponse,
    PanelUserModel,
    PanelUserUpdateRequest,
    RhPublicacionRequest,
    RhPublicacionUpdateRequest,
    RhUploadRequest,
    SignedUploadResponse,
)
from app.utils import now_utc_iso

logger = logging.getLogger("signage.panel")
settings = get_settings()

me_router = APIRouter(tags=["panel"])
rh_router = APIRouter(prefix="/rh", tags=["rh"])
usuarios_router = APIRouter(prefix="/admin/usuarios", tags=["admin"], dependencies=[Depends(get_current_admin)])


@me_router.get("/me", response_model=MeResponse)
async def me(user: PanelUser = Depends(get_current_user)):
    return MeResponse(email=user.email, rol=user.rol, nombre=user.nombre, superadmin=user.superadmin)


# --------------------------------------------------------------------------
# Sección de RH -> Sheet (Apps Script)
# --------------------------------------------------------------------------
async def llamar_sheet(accion: str, usuario: str = "", **extra: Any) -> dict:
    """POST a la web app del Sheet. Apps Script responde con un 302 a
    googleusercontent.com que hay que seguir con GET (httpx lo hace así)."""
    if not settings.apps_script_panel_url or not settings.sync_api_key:
        raise HTTPException(status_code=503, detail="La sección de RH no está configurada (APPS_SCRIPT_PANEL_URL).")
    payload = {"key": settings.sync_api_key, "accion": accion, "usuario": usuario, **extra}
    try:
        async with httpx.AsyncClient(timeout=90, follow_redirects=True) as client:
            resp = await client.post(settings.apps_script_panel_url, json=payload)
        data = resp.json()
    except Exception as exc:  # red, timeout, HTML de error de Google en vez de JSON
        logger.warning("Apps Script %s falló: %s", accion, exc)
        raise HTTPException(status_code=502, detail="No se pudo comunicar con el Sheet. Intenta de nuevo en un momento.")
    if not data.get("ok"):
        raise HTTPException(status_code=400, detail=data.get("error") or "El Sheet rechazó la operación.")
    return data


@rh_router.get("/pantallas")
async def rh_pantallas(user: PanelUser = Depends(get_current_user)):
    return {"pantallas": (await llamar_sheet("pantallas", user.email)).get("pantallas", [])}


_NOMBRE_ORIGINAL = re.compile(r"nombre original:\s*(.+?)\s*$", re.I)


def armar_sucursales(groups: list[dict], devices: list[dict]) -> list[dict]:
    """Sucursales (grupos con "nombre original: X" en la descripción, igual que el
    sync del Sheet) + el estado de su(s) TV(s), para la Vista previa."""
    tvs: dict[str, list[dict]] = {}
    for d in devices:
        if d.get("groupId") and d.get("estado") == "activo":
            tvs.setdefault(d["groupId"], []).append({
                "nombre": d.get("nombre") or d.get("deviceId"), "online": bool(d.get("online")),
                "lastSeen": d.get("lastSeen"), "itemActual": d.get("itemActual"),
            })
    out = []
    for g in groups:
        m = _NOMBRE_ORIGINAL.search(g.get("descripcion") or "")
        if not m:
            continue
        gid = g.get("groupId")
        s = {"g": gid, "n": g.get("nombre") or gid, "suc": m.group(1),
             "tz": g.get("timezone") or settings.business_timezone, "tvs": tvs.get(gid, [])}
        # El mismo link que arma el sync del Sheet para la TV (con el token del kiosco).
        s["url"] = settings.pantalla_url + "?" + urlencode(
            {"suc": s["suc"], "g": gid, "n": s["n"], "tz": s["tz"], "k": settings.kiosco_token})
        out.append(s)
    return sorted(out, key=lambda s: s["n"])


@rh_router.get("/sucursales")
async def rh_sucursales(user: PanelUser = Depends(get_current_user), repo: FirestoreRepo = Depends(get_repo)):
    return {"sucursales": armar_sucursales(await repo.list_groups(), await repo.list_devices(limit=10_000))}


@rh_router.get("/publicaciones")
async def rh_publicaciones(user: PanelUser = Depends(get_current_user)):
    return {"publicaciones": (await llamar_sheet("listar", user.email)).get("publicaciones", [])}


@rh_router.post("/publicaciones")
async def rh_publicar(body: RhPublicacionRequest, user: PanelUser = Depends(get_rh_user)):
    if body.archivoUrl and not body.archivoUrl.startswith(
        f"https://storage.googleapis.com/{settings.gcs_assets_bucket}/"
    ):
        raise HTTPException(status_code=400, detail="El archivo no se subió correctamente.")
    if body.fondoUrl and not fondo_valido(body.fondoUrl):
        raise HTTPException(status_code=400, detail="El fondo no se subió correctamente.")
    if body.fondoUrl and body.tipo not in ("Comunicado", "Evento"):
        raise HTTPException(status_code=400, detail="El fondo solo aplica a comunicados y eventos.")
    r = await llamar_sheet("publicar", user.email, datos=body.model_dump())
    logger.info("RH publicó %s (%s) por %s", r.get("id"), body.tipo, user.email)
    return {"id": r.get("id"), "sincronizacion": r.get("sincronizacion")}


@rh_router.patch("/publicaciones/{pub_id}")
async def rh_actualizar(pub_id: str, body: RhPublicacionUpdateRequest, user: PanelUser = Depends(get_rh_user)):
    cambios = body.model_dump(exclude_none=True)
    if not cambios:
        raise HTTPException(status_code=400, detail="No hay cambios.")
    r = await llamar_sheet("actualizar", user.email, id=pub_id, cambios=cambios)
    logger.info("RH actualizó %s %s por %s", pub_id, cambios, user.email)
    return {"id": pub_id, "sincronizacion": r.get("sincronizacion")}


@rh_router.post("/publicaciones/{pub_id}/duplicar")
async def rh_duplicar(pub_id: str, user: PanelUser = Depends(get_rh_user)):
    r = await llamar_sheet("duplicar", user.email, id=pub_id)
    return {"id": r.get("id")}


@rh_router.post("/upload-url", response_model=SignedUploadResponse)
async def rh_upload_url(
    body: RhUploadRequest, user: PanelUser = Depends(get_rh_user), gcs: GcsClient = Depends(get_gcs_client)
):
    upload_url, gcs_path, cdn_url = gcs.build_signed_upload_url(body.filename, body.contentType)
    return SignedUploadResponse(
        uploadUrl=upload_url, gcsPath=gcs_path, cdnUrl=cdn_url, headers={"Content-Type": body.contentType}
    )


# --------------------------------------------------------------------------
# Galería de fondos (comunicados y eventos)
# --------------------------------------------------------------------------
@rh_router.get("/fondos", response_model=list[FondoModel])
async def rh_fondos(user: PanelUser = Depends(get_current_user), repo: FirestoreRepo = Depends(get_repo)):
    fondos = [FondoModel(**f) for f in await repo.list_fondos()]
    return sorted(fondos, key=lambda f: (f.tipo != "fabrica", f.orden, f.creado or "", f.nombre))


@rh_router.post("/fondos", response_model=FondoModel)
async def rh_guardar_fondo(
    body: FondoCreateRequest, user: PanelUser = Depends(get_rh_user), repo: FirestoreRepo = Depends(get_repo)
):
    if not fondo_valido(body.url):
        raise HTTPException(status_code=400, detail="El fondo no se subió correctamente.")
    fondo_id = f"f-{secrets.token_hex(5)}"
    campos = {"nombre": body.nombre.strip(), "url": body.url.strip(), "tipo": "subido",
              "creadoPor": user.email, "creado": now_utc_iso(), "orden": 1000}
    await repo.create_fondo(fondo_id, campos)
    logger.info("Fondo %s guardado por %s", fondo_id, user.email)
    return FondoModel(fondoId=fondo_id, **campos)


@rh_router.delete("/fondos/{fondo_id}")
async def rh_borrar_fondo(fondo_id: str, user: PanelUser = Depends(get_rh_user), repo: FirestoreRepo = Depends(get_repo)):
    f = await repo.get_fondo(fondo_id)
    if not f:
        raise HTTPException(status_code=404, detail="Ese fondo no existe.")
    if f.get("tipo") == "fabrica":
        raise HTTPException(status_code=400, detail="Los fondos de fábrica no se pueden borrar.")
    if user.rol != "admin" and f.get("creadoPor") != user.email:
        raise HTTPException(status_code=403, detail="Solo quien lo subió o un administrador puede quitarlo.")
    # Solo sale de la galería: las publicaciones que ya lo usan lo siguen mostrando.
    await repo.delete_fondo(fondo_id)
    return {"ok": True}


# --------------------------------------------------------------------------
# Usuarios del panel (solo administradores)
# --------------------------------------------------------------------------
def _superadmins() -> list[PanelUserModel]:
    return [PanelUserModel(email=e, rol="admin", superadmin=True) for e in sorted(settings.admin_email_allowlist_set)]


@usuarios_router.get("", response_model=list[PanelUserModel])
async def listar_usuarios(repo: FirestoreRepo = Depends(get_repo)):
    fijos = _superadmins()
    correos_fijos = {u.email for u in fijos}
    otros = [PanelUserModel(**u) for u in await repo.list_panel_users() if u["email"] not in correos_fijos]
    return fijos + otros


def _asegurar_cuenta_firebase(email: str, nombre: str) -> bool:
    """Crea (o reactiva) la cuenta de acceso. True = cuenta nueva.
    Se crea con contraseña aleatoria y correo verificado (el admin responde por
    él); la persona pone su contraseña con el correo que le manda el panel."""
    try:
        u = firebase_auth.get_user_by_email(email)
        if u.disabled or not u.email_verified:
            firebase_auth.update_user(u.uid, disabled=False, email_verified=True)
        return False
    except firebase_auth.UserNotFoundError:
        firebase_auth.create_user(
            email=email, email_verified=True, password=secrets.token_urlsafe(24), display_name=nombre or None
        )
        return True


@usuarios_router.post("", response_model=PanelUserCreateResponse)
async def crear_usuario(
    body: PanelUserCreateRequest, admin: AdminUser = Depends(get_current_admin), repo: FirestoreRepo = Depends(get_repo)
):
    email = body.email.strip().lower()
    if email in settings.admin_email_allowlist_set:
        raise HTTPException(status_code=400, detail="Ese correo ya es administrador fijo del panel.")
    try:
        nueva = await run_in_threadpool(_asegurar_cuenta_firebase, email, body.nombre.strip())
    except Exception as exc:  # p. ej. el servidor sin permiso de Firebase Auth (roles/firebaseauth.admin)
        logger.error("No se pudo crear la cuenta de %s: %s", email, exc)
        raise HTTPException(status_code=503, detail="No se pudo crear la cuenta de acceso en Firebase. Avísale al administrador del sistema.")
    previo = await repo.get_panel_user(email)
    campos = {"nombre": body.nombre.strip(), "rol": body.rol, "activo": True}
    if not previo:
        campos.update({"creado": now_utc_iso(), "creadoPor": admin.email})
    await repo.set_panel_user(email, campos)
    logger.info("Usuario %s (%s) dado de alta por %s", email, body.rol, admin.email)
    return PanelUserCreateResponse(usuario=PanelUserModel(**{**(previo or {}), **campos, "email": email}), cuentaNueva=nueva)


@usuarios_router.post("/{email}/link-contrasena")
async def link_contrasena(
    email: str, request: Request, admin: AdminUser = Depends(get_current_admin), repo: FirestoreRepo = Depends(get_repo)
):
    """Link para que la persona cree (o cambie) su contraseña. El admin se lo manda por el medio
    que quiera: el correo automático de Firebase a veces se queda en cuarentena en Outlook/365."""
    email = email.strip().lower()
    u = await repo.get_panel_user(email)
    if not u or u.get("activo") is False:
        raise HTTPException(status_code=404, detail="Ese usuario no existe o está desactivado.")
    origen = request.headers.get("origin") or ""
    destino = (origen if origen in settings.cors_allow_origins_list else "https://captasoluciones-signage.web.app") + "/login"
    try:
        link = await run_in_threadpool(
            firebase_auth.generate_password_reset_link, email, firebase_auth.ActionCodeSettings(url=destino)
        )
    except Exception as exc:
        logger.error("No se pudo generar el link de contraseña de %s: %s", email, exc)
        raise HTTPException(status_code=503, detail="No se pudo generar el link. Intenta de nuevo.")
    logger.info("Link de contraseña de %s generado por %s", email, admin.email)
    return {"email": email, "link": link + "&lang=es"}


@usuarios_router.patch("/{email}", response_model=PanelUserModel)
async def editar_usuario(
    email: str, body: PanelUserUpdateRequest,
    admin: AdminUser = Depends(get_current_admin), repo: FirestoreRepo = Depends(get_repo),
):
    email = email.strip().lower()
    previo = await repo.get_panel_user(email)
    if not previo:
        raise HTTPException(status_code=404, detail="Ese usuario no existe.")
    cambios = body.model_dump(exclude_none=True)
    if email == admin.email and (cambios.get("activo") is False or cambios.get("rol", "admin") != "admin"):
        raise HTTPException(status_code=400, detail="No puedes quitarte a ti mismo el acceso de administrador.")
    if "activo" in cambios:
        def _cuenta(activo: bool):
            try:
                u = firebase_auth.get_user_by_email(email)
                firebase_auth.update_user(u.uid, disabled=not activo)
            except firebase_auth.UserNotFoundError:
                pass
        try:
            await run_in_threadpool(_cuenta, cambios["activo"])
        except Exception as exc:
            logger.error("No se pudo %s la cuenta de %s: %s", "activar" if cambios["activo"] else "desactivar", email, exc)
            raise HTTPException(status_code=503, detail="No se pudo cambiar la cuenta de acceso en Firebase. Intenta de nuevo.")
    await repo.set_panel_user(email, cambios)
    logger.info("Usuario %s modificado %s por %s", email, cambios, admin.email)
    return PanelUserModel(**{**previo, **cambios, "email": email})
