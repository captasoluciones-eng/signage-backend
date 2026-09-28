"""
Sheet -> playlists sync. The automation that reads the Google Sheet
"CaptaVision · Contenido de Pantallas" sends the full desired state here every
few minutes; this module turns it into one playlist per group.

Ownership rule: playlist items whose id starts with "sheet-" belong to the
Sheet and are replaced on every sync; any other item (added by hand in the
admin panel) is kept as-is. A group only gets a Sheet-managed playlist the
first time the Sheet has something for it, and nothing is written when the
resulting items are identical (so the devices' ETag doesn't churn).

Auth: X-Sync-Key shared secret (settings.sync_api_key), see deps.verify_sync_key.
"""
from __future__ import annotations

import html
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from app.cache import playlist_cache
from app.deps import verify_sync_key
from app.firestore_repo import FirestoreRepo, get_repo
from app.gcs_client import GcsClient, get_gcs_client
from app.schemas import (
    GroupSettingsModel,
    SignedUploadRequest,
    SignedUploadResponse,
    SyncRequest,
    SyncResponse,
)
from app.utils import is_item_vigente, now_utc_iso, resolve_tz

router = APIRouter(prefix="/sync", tags=["sync"], dependencies=[Depends(verify_sync_key)])
comunicado_router = APIRouter(prefix="/public", tags=["public"])

SHEET_PREFIX = "sheet-"
TODAS = "*"


def _is_sheet_item(item: dict) -> bool:
    return str(item.get("id", "")).startswith(SHEET_PREFIX)


_DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
          "septiembre", "octubre", "noviembre", "diciembre"]


def fecha_larga(iso: Optional[str]) -> str:
    """'2026-10-02' -> 'Viernes 2 de octubre de 2026' (texto del evento)."""
    try:
        d = datetime.strptime(str(iso), "%Y-%m-%d")
    except (TypeError, ValueError):
        return ""
    return f"{_DIAS[d.weekday()].capitalize()} {d.day} de {_MESES[d.month - 1]} de {d.year}"


def hora_ampm(hhmm: Optional[str]) -> str:
    try:
        h, m = (int(x) for x in str(hhmm).split(":")[:2])
    except (TypeError, ValueError):
        return ""
    sufijo = "a.m." if h < 12 else "p.m."
    return f"{(h % 12) or 12}:{m:02d} {sufijo}"


def comunicado_url(base_url: str, titulo: str, texto: str) -> str:
    return f"{base_url.rstrip('/')}/public/comunicado?{urlencode({'t': titulo, 'm': texto})}"


def plan_sync(
    req: SyncRequest,
    groups: dict[str, dict],
    playlists: dict[str, dict],
    base_url: str,
) -> dict:
    """Pure planning step (no I/O), so it can be unit-tested. Returns
    {"create_groups", "update_groups", "write_playlists", "unknown"}."""
    create_groups: dict[str, dict] = {}
    update_groups: dict[str, dict] = {}

    for g in req.grupos:
        gid = g.groupId.strip()
        if not gid or gid == TODAS:
            continue
        wanted = {"nombre": g.nombre, "descripcion": g.descripcion, "timezone": g.timezone}
        current = groups.get(gid)
        if current is None:
            create_groups[gid] = {
                **wanted,
                "settings": GroupSettingsModel().model_dump(),
                "playlistId": None,
            }
        else:
            diff = {k: v for k, v in wanted.items() if current.get(k) != v}
            if diff:
                update_groups[gid] = diff

    all_groups = {**groups, **{gid: {**f, "groupId": gid} for gid, f in create_groups.items()}}

    # Sheet items per target group.
    per_group: dict[str, list[dict]] = {gid: [] for gid in all_groups}
    unknown: set[str] = set()
    targets_of = {}
    for it in req.items:
        targets = set(all_groups) if TODAS in it.grupos else set(it.grupos)
        unknown |= targets - set(all_groups)
        targets_of[it.id] = targets & set(all_groups)
    # Groups that have a KPI screen play their other Sheet items inside it.
    con_pantalla = {gid for it in req.items if it.esPantalla for gid in targets_of[it.id]}
    for it in req.items:
        if it.type == "link" and not it.url:
            continue
        for gid in targets_of[it.id]:
            per_group[gid].append(
                {
                    "id": f"{SHEET_PREFIX}{it.id}",
                    "type": it.type,
                    "url": it.url,
                    "titulo": it.titulo,
                    "texto": it.texto,
                    "soloPantalla": gid in con_pantalla and not it.esPantalla,
                    **({"evento": {"fotoUrl": it.fotoUrl, "fecha": it.eventoFecha,
                                   "hora": it.eventoHora, "lugar": it.eventoLugar, "cta": it.eventoCta}}
                       if it.esEvento else {}),
                    "durationSec": it.durationSec,
                    "scale": "fill",
                    "orden": it.orden,
                    "activo": True,
                    "vigenciaDesde": it.vigenciaDesde,
                    "vigenciaHasta": it.vigenciaHasta,
                    "dias": it.dias,
                    "horaInicio": it.horaInicio,
                    "horaFin": it.horaFin,
                }
            )

    usage: dict[str, int] = {}
    for g in all_groups.values():
        if g.get("playlistId"):
            usage[g["playlistId"]] = usage.get(g["playlistId"], 0) + 1

    write_playlists: dict[str, dict] = {}
    for gid, sheet_items in per_group.items():
        group = all_groups[gid]
        pid = group.get("playlistId")
        current = playlists.get(pid) if pid else None
        current_items = (current or {}).get("items", [])

        if not sheet_items and not any(_is_sheet_item(i) for i in current_items):
            continue  # nothing from the Sheet, now or before: leave the group alone

        manual = [i for i in current_items if not _is_sheet_item(i)]
        dedicated = f"pl-sheet-{gid}"
        if not pid or pid == "default" or (usage.get(pid, 0) > 1 and pid != dedicated):
            # Don't touch the global default or a playlist other groups share:
            # give this group its own copy (keeping its hand-made items).
            pid = dedicated
            current = playlists.get(pid)
            if current is not None:
                manual = [i for i in current.get("items", []) if not _is_sheet_item(i)]
            target = update_groups if gid in groups else create_groups
            target.setdefault(gid, {})["playlistId"] = pid

        new_items = manual + sorted(sheet_items, key=lambda i: (i["orden"], i["id"]))
        if current is not None and current.get("items", []) == new_items:
            continue
        write_playlists[pid] = {
            "nombre": (current or {}).get("nombre") or f"Sheet · {group.get('nombre', gid)}",
            "items": new_items,
            "exists": current is not None,
            "groupId": gid,
        }

    return {
        "create_groups": create_groups,
        "update_groups": update_groups,
        "write_playlists": write_playlists,
        "unknown": sorted(unknown),
    }


@router.post("/contenido", response_model=SyncResponse)
async def sync_contenido(
    body: SyncRequest, request: Request, repo: FirestoreRepo = Depends(get_repo)
):
    base_url = str(request.base_url)
    for it in body.items:
        if it.type == "evento":
            detalle = " · ".join(x for x in [fecha_larga(it.eventoFecha), hora_ampm(it.eventoHora), it.eventoLugar] if x)
            texto = "\n".join(x for x in [it.texto, detalle] if x)
            it.url = comunicado_url(base_url, it.titulo or "", texto)
            it.type = "link"
            it.esEvento = True
        elif it.type == "comunicado":
            it.url = comunicado_url(base_url, it.titulo or "", it.texto or "")
            it.type = "link"

    groups = {g["groupId"]: g for g in await repo.list_groups()}
    playlists = {p["playlistId"]: p for p in await repo.list_playlists()}
    plan = plan_sync(body, groups, playlists, base_url)

    for gid, fields in plan["create_groups"].items():
        await repo.create_group(gid, fields)
    for gid, fields in plan["update_groups"].items():
        await repo.update_group(gid, fields)
    for pid, pl in plan["write_playlists"].items():
        fields = {"nombre": pl["nombre"], "items": pl["items"], "updatedAt": now_utc_iso()}
        if pl["exists"]:
            await repo.update_playlist(pid, fields)
        else:
            await repo.create_playlist(pid, fields)

    if body.pantalla is not None:
        ref = repo.client.collection("config").document("pantalla")
        snap = await ref.get()
        actual = (snap.to_dict() or {}) if snap.exists else {}
        if actual.get("config") != body.pantalla:
            await ref.set({"config": body.pantalla, "updatedAt": now_utc_iso()})

    touched = set(plan["create_groups"]) | set(plan["update_groups"]) | {
        pl["groupId"] for pl in plan["write_playlists"].values()
    }
    # A playlist change reaches every group that points at it.
    changed_pids = set(plan["write_playlists"])
    touched |= {gid for gid, g in groups.items() if g.get("playlistId") in changed_pids}
    for gid in touched:
        playlist_cache.invalidate_group(gid)

    return SyncResponse(
        gruposCreados=sorted(plan["create_groups"]),
        gruposActualizados=sorted(plan["update_groups"]),
        playlistsActualizadas=sorted(plan["write_playlists"]),
        gruposDesconocidos=plan["unknown"],
    )


@router.post("/upload-url", response_model=SignedUploadResponse)
async def sync_upload_url(body: SignedUploadRequest, gcs: GcsClient = Depends(get_gcs_client)):
    upload_url, gcs_path, cdn_url = gcs.build_signed_upload_url(body.filename, body.contentType)
    return SignedUploadResponse(
        uploadUrl=upload_url,
        gcsPath=gcs_path,
        cdnUrl=cdn_url,
        headers={"Content-Type": body.contentType},
    )


# --------------------------------------------------------------------------
# Data for the per-sucursal KPI screen (kiosko.../pantalla/?g=<groupId>):
# the "Diseño Pantallas" config plus the group's RH items that are currently
# vigentes, which the screen interleaves with the indicator screens.
# --------------------------------------------------------------------------
@comunicado_router.get("/pantalla/{group_id}")
async def pantalla(group_id: str, repo: FirestoreRepo = Depends(get_repo)):
    snap = await repo.client.collection("config").document("pantalla").get()
    config = ((snap.to_dict() or {}).get("config")) if snap.exists else None

    group = await repo.get_group(group_id)
    contenido: list[dict] = []
    if group and group.get("playlistId"):
        playlist = await repo.get_playlist(group["playlistId"]) or {}
        tz = resolve_tz(group.get("timezone"))
        for it in playlist.get("items", []):
            if not it.get("soloPantalla") or not it.get("activo", True):
                continue
            if not is_item_vigente(it.get("vigenciaDesde"), it.get("vigenciaHasta"),
                                   dias=it.get("dias"), hora_inicio=it.get("horaInicio"),
                                   hora_fin=it.get("horaFin"), tz=tz):
                continue
            es_comunicado = it.get("type") == "link" and "/public/comunicado" in str(it.get("url", ""))
            contenido.append({
                "id": it["id"],
                "tipo": "evento" if it.get("evento") else "comunicado" if es_comunicado else it.get("type"),
                "evento": it.get("evento"),
                "url": it.get("url"),
                "titulo": it.get("titulo"),
                "texto": it.get("texto"),
                "durationSec": it.get("durationSec"),
                "orden": it.get("orden", 0),
            })
        contenido.sort(key=lambda i: (i["orden"], i["id"]))

    anuncio = await repo.get_rh_announcement(group_id) if group else None
    if anuncio and not anuncio.get("activo", True):
        anuncio = None

    return JSONResponse(
        {"groupId": group_id, "existe": group is not None, "config": config,
         "contenido": contenido, "anuncio": anuncio, "generado": now_utc_iso()},
        headers={"Cache-Control": "public, max-age=60"},
    )


# --------------------------------------------------------------------------
# Text-only "Comunicado" slide, shown by the players as a `link` item.
# --------------------------------------------------------------------------
_COMUNICADO_HTML = """<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comunicado</title>
<style>
  html,body{{margin:0;height:100%;}}
  body{{background:#1F3A5F;color:#fff;font-family:'Segoe UI',Roboto,Arial,sans-serif;
       display:flex;align-items:center;justify-content:center;overflow:hidden;}}
  .box{{width:84vw;}}
  .tag{{display:inline-block;background:#F5B700;color:#1F3A5F;font-weight:700;letter-spacing:.12em;
        font-size:2.2vw;padding:.6vw 1.6vw;border-radius:.6vw;text-transform:uppercase;}}
  h1{{font-size:6vw;line-height:1.05;margin:3vw 0 2.5vw;font-weight:800;}}
  p{{font-size:3.2vw;line-height:1.35;margin:0;opacity:.95;white-space:pre-line;}}
  .pie{{position:fixed;bottom:3vw;left:8vw;right:8vw;display:flex;justify-content:space-between;
        font-size:1.6vw;opacity:.7;}}
</style></head>
<body><div class="box">
  <span class="tag">Comunicado</span>
  <h1>{titulo}</h1>
  <p>{texto}</p>
</div>
<div class="pie"><span>Capta · Recursos Humanos</span><span>CaptaVision</span></div>
</body></html>"""


@comunicado_router.get("/comunicado", response_class=HTMLResponse)
async def comunicado(t: str = Query("", max_length=200), m: str = Query("", max_length=1000)):
    return HTMLResponse(
        _COMUNICADO_HTML.format(titulo=html.escape(t), texto=html.escape(m)),
        headers={"Cache-Control": "public, max-age=3600"},
    )
