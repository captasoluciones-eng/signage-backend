"""
Unit tests for the Sheet -> playlists planning step and the extended
vigencia rules (days / hours / per-group timezone). No GCP needed.
"""
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.routers.sync import comunicado_url, plan_sync  # noqa: E402
from app.schemas import SyncRequest  # noqa: E402
from app.utils import is_item_vigente  # noqa: E402

BASE = "https://backend.example/"
MZT = ZoneInfo("America/Mazatlan")


def _req(grupos=(), items=()):
    return SyncRequest(grupos=list(grupos), items=list(items))


def _item(id_, grupos, **kw):
    return {"id": id_, "type": "imagen", "url": f"https://x/{id_}.jpg", "grupos": grupos, **kw}


def test_creates_missing_group_with_dedicated_playlist():
    plan = plan_sync(
        _req([{"groupId": "culiacan", "nombre": "Culiacán", "timezone": "America/Mazatlan"}],
             [_item("C-1", ["culiacan"])]),
        groups={}, playlists={}, base_url=BASE,
    )
    assert plan["create_groups"]["culiacan"]["playlistId"] == "pl-sheet-culiacan"
    pl = plan["write_playlists"]["pl-sheet-culiacan"]
    assert pl["exists"] is False
    assert [i["id"] for i in pl["items"]] == ["sheet-C-1"]


def test_manual_items_are_kept_and_sheet_items_replaced():
    groups = {"rh": {"groupId": "rh", "nombre": "Oficina RH", "playlistId": "pl-rh"}}
    playlists = {"pl-rh": {"playlistId": "pl-rh", "nombre": "RH", "items": [
        {"id": "manual-1", "type": "link", "url": "https://tablero", "orden": 0},
        {"id": "sheet-VIEJO", "type": "imagen", "url": "https://x/old.jpg", "orden": 1},
    ]}}
    plan = plan_sync(_req(items=[_item("C-2", ["rh"], orden=5)]), groups, playlists, BASE)
    ids = [i["id"] for i in plan["write_playlists"]["pl-rh"]["items"]]
    assert ids == ["manual-1", "sheet-C-2"]
    assert "rh" not in plan["update_groups"]  # keeps pointing at its own playlist


def test_todas_reaches_every_group_and_unknown_is_reported():
    groups = {g: {"groupId": g, "nombre": g, "playlistId": None} for g in ("a", "b")}
    plan = plan_sync(
        _req(items=[_item("C-3", ["*"]), _item("C-4", ["zzz"])]), groups, {}, BASE
    )
    assert set(plan["write_playlists"]) == {"pl-sheet-a", "pl-sheet-b"}
    assert plan["unknown"] == ["zzz"]


def test_no_write_when_nothing_changed():
    groups = {"a": {"groupId": "a", "nombre": "A", "playlistId": "pl-sheet-a"}}
    first = plan_sync(_req(items=[_item("C-5", ["a"])]), groups, {}, BASE)
    playlists = {"pl-sheet-a": {"playlistId": "pl-sheet-a", "nombre": "Sheet · A",
                                "items": first["write_playlists"]["pl-sheet-a"]["items"]}}
    second = plan_sync(_req(items=[_item("C-5", ["a"])]), groups, playlists, BASE)
    assert second["write_playlists"] == {}


def test_removed_row_clears_sheet_items_but_untouched_groups_are_skipped():
    groups = {"a": {"groupId": "a", "nombre": "A", "playlistId": "pl-sheet-a"},
              "b": {"groupId": "b", "nombre": "B", "playlistId": None}}
    playlists = {"pl-sheet-a": {"playlistId": "pl-sheet-a", "nombre": "Sheet · A",
                                "items": [{"id": "sheet-C-6", "type": "imagen", "url": "u", "orden": 0}]}}
    plan = plan_sync(_req(), groups, playlists, BASE)
    assert plan["write_playlists"]["pl-sheet-a"]["items"] == []
    assert "pl-sheet-b" not in plan["write_playlists"]


def test_shared_or_default_playlist_is_not_modified():
    groups = {"a": {"groupId": "a", "nombre": "A", "playlistId": "compartida"},
              "b": {"groupId": "b", "nombre": "B", "playlistId": "compartida"}}
    playlists = {"compartida": {"playlistId": "compartida", "nombre": "X",
                                "items": [{"id": "m", "type": "link", "url": "u", "orden": 0}]}}
    plan = plan_sync(_req(items=[_item("C-7", ["a"])]), groups, playlists, BASE)
    assert "compartida" not in plan["write_playlists"]
    assert plan["update_groups"]["a"]["playlistId"] == "pl-sheet-a"
    assert [i["id"] for i in plan["write_playlists"]["pl-sheet-a"]["items"]] == ["m", "sheet-C-7"]


def test_comunicado_url_is_encoded():
    assert comunicado_url(BASE, "Día inhábil", "No se labora & listo") == (
        "https://backend.example/public/comunicado?t=D%C3%ADa+inh%C3%A1bil&m=No+se+labora+%26+listo"
    )


# ---- vigencia: days / hours / timezone ----
LUNES_10AM = datetime(2026, 9, 28, 10, 0, tzinfo=MZT)   # Monday
SABADO_10AM = datetime(2026, 9, 26, 10, 0, tzinfo=MZT)  # Saturday


def test_dias_lunes_a_viernes():
    assert is_item_vigente(None, None, dias="Lunes a viernes", now=LUNES_10AM) is True
    assert is_item_vigente(None, None, dias="Lunes a viernes", now=SABADO_10AM) is False
    assert is_item_vigente(None, None, dias="Fines de semana", now=SABADO_10AM) is True


def test_horas_window():
    assert is_item_vigente(None, None, hora_inicio="08:00", hora_fin="14:00", now=LUNES_10AM) is True
    assert is_item_vigente(None, None, hora_inicio="11:00", now=LUNES_10AM) is False
    assert is_item_vigente(None, None, hora_fin="10:00", now=LUNES_10AM) is False


def test_hasta_date_includes_whole_day():
    assert is_item_vigente(None, "2026-09-28", now=datetime(2026, 9, 28, 22, 0, tzinfo=MZT)) is True
    assert is_item_vigente(None, "2026-09-27", now=LUNES_10AM) is False


def test_timezone_is_respected():
    tj = ZoneInfo("America/Tijuana")
    # In January Tijuana has no DST: 10:00 Mazatlán (UTC-7) == 09:00 Tijuana (UTC-8),
    # so a 09:30 start excludes it in Tijuana but not in Mazatlán.
    enero = datetime(2027, 1, 11, 10, 0, tzinfo=MZT)
    assert is_item_vigente(None, None, hora_inicio="09:30", tz=tj, now=enero) is False
    assert is_item_vigente(None, None, hora_inicio="09:30", tz=MZT, now=enero) is True


def test_group_with_kpi_screen_plays_rh_items_inside_it():
    groups = {"culiacan": {"groupId": "culiacan", "nombre": "Culiacán", "playlistId": None},
              "rh": {"groupId": "rh", "nombre": "Oficina RH", "playlistId": None}}
    items = [
        {"id": "KPI-culiacan", "type": "link", "url": "https://k/pantalla/?g=culiacan",
         "grupos": ["culiacan"], "esPantalla": True},
        _item("C-8", ["*"]),
    ]
    plan = plan_sync(_req(items=items), groups, {}, BASE)
    cul = {i["id"]: i for i in plan["write_playlists"]["pl-sheet-culiacan"]["items"]}
    assert cul["sheet-KPI-culiacan"]["soloPantalla"] is False
    assert cul["sheet-C-8"]["soloPantalla"] is True
    # A group without a KPI screen still plays the photo on its own.
    rh = plan["write_playlists"]["pl-sheet-rh"]["items"]
    assert [(i["id"], i["soloPantalla"]) for i in rh] == [("sheet-C-8", False)]


def test_evento_helpers():
    from app.routers.sync import fecha_larga, hora_ampm
    assert fecha_larga("2026-10-02") == "Viernes 2 de octubre de 2026"
    assert hora_ampm("14:00") == "2:00 p.m." and hora_ampm("09:30") == "9:30 a.m."
    assert fecha_larga(None) == "" and hora_ampm("") == ""
