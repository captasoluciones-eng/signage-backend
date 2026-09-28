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
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse

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
from app.utils import now_utc_iso

router = APIRouter(prefix="/sync", tags=["sync"], dependencies=[Depends(verify_sync_key)])
comunicado_router = APIRouter(prefix="/public", tags=["public"])

SHEET_PREFIX = "sheet-"
TODAS = "*"


def _is_sheet_item(item: dict) -> bool:
    return str(item.get("id", "")).startswith(SHEET_PREFIX)


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
    for it in req.items:
        targets = set(all_groups) if TODAS in it.grupos else set(it.grupos)
        unknown |= targets - set(all_groups)
        if it.type == "link" and not it.url:
            continue
        for gid in targets & set(all_groups):
            per_group[gid].append(
                {
                    "id": f"{SHEET_PREFIX}{it.id}",
                    "type": it.type,
                    "url": it.url,
                    "titulo": it.titulo,
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
        if it.type == "comunicado":
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
