"""
Pruebas de roles del panel y de la sección de RH (Sheet simulado). Sin GCP.
"""
import asyncio
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import deps  # noqa: E402
from app.routers import panel  # noqa: E402


class FakeRepo:
    def __init__(self, users=None):
        self.users = {k: dict(v) for k, v in (users or {}).items()}

    async def get_panel_user(self, email):
        u = self.users.get(email.lower())
        return {**u, "email": email.lower()} if u else None

    async def list_panel_users(self):
        return [{**v, "email": k} for k, v in sorted(self.users.items())]

    async def set_panel_user(self, email, fields):
        self.users.setdefault(email.lower(), {}).update(fields)


def resolver(decoded, repo):
    return asyncio.run(deps.resolve_panel_user(decoded, repo))


@pytest.fixture(autouse=True)
def config(monkeypatch):
    monkeypatch.setattr(deps.settings, "admin_email_allowlist", "jefe@gmail.com")
    monkeypatch.setattr(panel.settings, "apps_script_panel_url", "https://script.example/exec")
    monkeypatch.setattr(panel.settings, "sync_api_key", "llave-secreta")
    monkeypatch.setattr(panel.settings, "gcs_assets_bucket", "bucket-prod")


# ---------------------------------------------------------------- roles
def test_superadmin_de_la_lista_fija_es_admin_aunque_no_este_en_firestore():
    u = resolver({"uid": "1", "email": "Jefe@Gmail.com", "email_verified": True}, FakeRepo())
    assert (u.email, u.rol, u.superadmin) == ("jefe@gmail.com", "admin", True)


def test_usuario_de_rh_dado_de_alta_entra_con_su_rol():
    repo = FakeRepo({"ana@outlook.com": {"rol": "rh", "activo": True, "nombre": "Ana"}})
    u = resolver({"uid": "2", "email": "ana@outlook.com", "email_verified": True}, repo)
    assert (u.rol, u.nombre, u.superadmin) == ("rh", "Ana", False)


@pytest.mark.parametrize("decoded,users", [
    ({"email": "x@outlook.com", "email_verified": True}, {}),  # no dado de alta
    ({"email": "ana@outlook.com", "email_verified": True}, {"ana@outlook.com": {"rol": "rh", "activo": False}}),  # desactivado
    ({"email": "ana@outlook.com", "email_verified": False}, {"ana@outlook.com": {"rol": "rh", "activo": True}}),  # sin verificar
    ({"email": "ana@outlook.com", "email_verified": True}, {"ana@outlook.com": {"rol": "jefazo", "activo": True}}),  # rol raro
])
def test_accesos_rechazados(decoded, users):
    with pytest.raises(HTTPException) as e:
        resolver(decoded, FakeRepo(users))
    assert e.value.status_code == 403


def test_rh_no_entra_a_lo_de_admin_y_lectura_no_publica():
    rh = deps.PanelUser("2", "ana@outlook.com", "rh")
    lectura = deps.PanelUser("3", "ver@outlook.com", "lectura")
    with pytest.raises(HTTPException) as e:
        asyncio.run(deps.get_current_admin(rh))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        asyncio.run(deps.get_rh_user(lectura))
    assert e.value.status_code == 403
    assert asyncio.run(deps.get_rh_user(rh)) is rh


# ---------------------------------------------------------------- endpoints
def cliente(rol, email="ana@outlook.com", repo=None):
    app = FastAPI()
    app.include_router(panel.me_router)
    app.include_router(panel.rh_router)
    app.include_router(panel.usuarios_router)
    user = deps.PanelUser("u", email, rol)
    app.dependency_overrides[deps.get_current_user] = lambda: user
    app.dependency_overrides[panel.get_repo] = lambda: repo or FakeRepo()
    return TestClient(app)


@pytest.fixture
def sheet(monkeypatch):
    llamadas = []

    async def falso(accion, usuario="", **extra):
        llamadas.append({"accion": accion, "usuario": usuario, **extra})
        if accion == "listar":
            return {"ok": True, "publicaciones": [{"id": "C-0007", "titulo": "Hola"}]}
        if accion == "publicar":
            return {"ok": True, "id": "C-0008", "sincronizacion": "Publicado"}
        return {"ok": True, "id": extra.get("id")}

    monkeypatch.setattr(panel, "llamar_sheet", falso)
    return llamadas


def test_me_devuelve_el_rol():
    r = cliente("rh").get("/me")
    assert r.status_code == 200 and r.json()["rol"] == "rh"


def test_lectura_puede_ver_pero_no_publicar(sheet):
    c = cliente("lectura")
    assert c.get("/rh/publicaciones").json()["publicaciones"][0]["id"] == "C-0007"
    r = c.post("/rh/publicaciones", json={"tipo": "Comunicado", "titulo": "x", "texto": "y", "pantallas": ["Todas"]})
    assert r.status_code == 403
    assert [x["accion"] for x in sheet] == ["listar"]


def test_rh_publica_con_su_correo_como_autor(sheet):
    r = cliente("rh").post("/rh/publicaciones", json={
        "tipo": "Foto", "titulo": "Cumpleañeros", "pantallas": ["Culiacán", "Mazatlán"],
        "archivoUrl": "https://storage.googleapis.com/bucket-prod/assets/abc.jpg", "dias": "Lunes a viernes"})
    assert r.status_code == 200 and r.json()["id"] == "C-0008"
    assert sheet[-1]["usuario"] == "ana@outlook.com"
    assert sheet[-1]["datos"]["pantallas"] == ["Culiacán", "Mazatlán"]


def test_rechaza_archivo_que_no_es_de_nuestro_almacenamiento(sheet):
    r = cliente("rh").post("/rh/publicaciones", json={
        "tipo": "Foto", "titulo": "x", "pantallas": ["Todas"], "archivoUrl": "https://evil.example/x.jpg"})
    assert r.status_code == 400 and not sheet


def test_editar_sin_cambios_es_error_y_con_cambios_va_al_sheet(sheet):
    c = cliente("rh")
    assert c.patch("/rh/publicaciones/C-0007", json={}).status_code == 400
    r = c.patch("/rh/publicaciones/C-0007", json={"activo": False, "hasta": "2026-10-20"})
    assert r.status_code == 200
    assert sheet[-1] == {"accion": "actualizar", "usuario": "ana@outlook.com", "id": "C-0007",
                         "cambios": {"activo": False, "hasta": "2026-10-20"}}


def test_subida_solo_acepta_imagen_o_mp4(monkeypatch):
    class Gcs:
        def build_signed_upload_url(self, filename, ct):
            return ("https://signed", "gs://b/x", "https://storage.googleapis.com/bucket-prod/assets/x.jpg")
    c = cliente("rh")
    c.app.dependency_overrides[panel.get_gcs_client] = lambda: Gcs()
    assert c.post("/rh/upload-url", json={"filename": "a.gif", "contentType": "image/gif"}).status_code == 422
    r = c.post("/rh/upload-url", json={"filename": "a.jpg", "contentType": "image/jpeg"})
    assert r.status_code == 200 and r.json()["cdnUrl"].endswith("x.jpg")


# ---------------------------------------------------------------- llamada real al Sheet (HTTP simulado)
def test_llamar_sheet_sigue_el_redirect_y_traduce_errores(monkeypatch):
    vistos = []

    def handler(req):
        vistos.append((req.method, str(req.url)))
        if req.url.host == "script.example":
            assert b'"key": "llave-secreta"' in req.content or b'"key":"llave-secreta"' in req.content
            return httpx.Response(302, headers={"Location": "https://googleusercontent.example/echo"})
        return httpx.Response(200, json={"ok": False, "error": "Falta el título."})

    real = httpx.AsyncClient
    monkeypatch.setattr(panel.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    with pytest.raises(HTTPException) as e:
        asyncio.run(panel.llamar_sheet("publicar", "ana@outlook.com", datos={}))
    assert e.value.status_code == 400 and e.value.detail == "Falta el título."
    assert vistos[0][0] == "POST" and vistos[1] == ("GET", "https://googleusercontent.example/echo")


def test_sin_configuracion_la_seccion_esta_apagada(monkeypatch):
    monkeypatch.setattr(panel.settings, "apps_script_panel_url", "")
    with pytest.raises(HTTPException) as e:
        asyncio.run(panel.llamar_sheet("listar"))
    assert e.value.status_code == 503


# ---------------------------------------------------------------- usuarios
def test_admin_da_de_alta_usuario_de_rh(monkeypatch):
    monkeypatch.setattr(panel, "_asegurar_cuenta_firebase", lambda email, nombre: True)
    repo = FakeRepo()
    c = cliente("admin", email="jefe@gmail.com", repo=repo)
    c.app.dependency_overrides[deps.get_current_admin] = lambda: deps.AdminUser("u", "jefe@gmail.com", "admin")
    r = c.post("/admin/usuarios", json={"email": "Ana.Lopez@Outlook.com", "nombre": "Ana López", "rol": "rh"})
    assert r.status_code == 200, r.text
    assert r.json()["cuentaNueva"] is True and r.json()["usuario"]["email"] == "ana.lopez@outlook.com"
    assert repo.users["ana.lopez@outlook.com"]["creadoPor"] == "jefe@gmail.com"
    lista = c.get("/admin/usuarios").json()
    assert [u["email"] for u in lista] == ["jefe@gmail.com", "ana.lopez@outlook.com"] and lista[0]["superadmin"]


def test_alta_rechaza_correo_invalido_y_superadmin(monkeypatch):
    monkeypatch.setattr(panel, "_asegurar_cuenta_firebase", lambda email, nombre: True)
    c = cliente("admin", email="jefe@gmail.com")
    c.app.dependency_overrides[deps.get_current_admin] = lambda: deps.AdminUser("u", "jefe@gmail.com", "admin")
    assert c.post("/admin/usuarios", json={"email": "no-es-correo", "rol": "rh"}).status_code == 422
    assert c.post("/admin/usuarios", json={"email": "jefe@gmail.com", "rol": "rh"}).status_code == 400


def test_admin_no_puede_quitarse_el_acceso_a_si_mismo(monkeypatch):
    repo = FakeRepo({"otro@outlook.com": {"rol": "admin", "activo": True}})
    c = cliente("admin", email="otro@outlook.com", repo=repo)
    c.app.dependency_overrides[deps.get_current_admin] = lambda: deps.AdminUser("u", "otro@outlook.com", "admin")
    assert c.patch("/admin/usuarios/otro@outlook.com", json={"activo": False}).status_code == 400
    assert c.patch("/admin/usuarios/otro@outlook.com", json={"rol": "rh"}).status_code == 400


def test_rh_no_puede_dar_de_alta_usuarios():
    c = cliente("rh")
    assert c.get("/admin/usuarios").status_code == 403


def test_sucursales_solo_las_que_tienen_nombre_original_y_su_tv():
    groups = [
        {"groupId": "culiacan", "nombre": "Culiacán", "timezone": "America/Mazatlan",
         "descripcion": "Sucursal · zona Pacífico (UTC-7) · nombre original: CULIACAN"},
        {"groupId": "rh", "nombre": "Oficina RH", "descripcion": "Pantalla de pruebas"},
        {"groupId": "tepic", "nombre": "Tepic", "descripcion": "Sucursal · nombre original: TEPIC"},
    ]
    devices = [{"deviceId": "d1", "groupId": "culiacan", "estado": "activo", "online": True, "nombre": "TV Culiacán",
                "lastSeen": "2026-10-09T15:00:00Z"},
               {"deviceId": "d2", "groupId": "tepic", "estado": "pendiente"}]
    s = panel.armar_sucursales(groups, devices)
    assert [x["g"] for x in s] == ["culiacan", "tepic"]
    assert s[0]["suc"] == "CULIACAN" and s[0]["tvs"][0]["online"] is True
    assert s[1]["tvs"] == [] and s[1]["tz"]  # sin TV vinculada; zona por omisión
    assert s[0]["url"].startswith(panel.settings.pantalla_url + "?suc=CULIACAN&g=culiacan&n=Culiac%C3%A1n")


# ---------------------------------------------------------------- fondos
from app.routers import sync as sync_mod  # noqa: E402

BUCKET_URL = "https://storage.googleapis.com/bucket-prod/fondos/navidad.jpg"


def test_lamina_de_comunicado_con_fondo_solo_de_nuestro_bucket(monkeypatch):
    monkeypatch.setattr(sync_mod.settings, "gcs_assets_bucket", "bucket-prod")
    con = asyncio.run(sync_mod.comunicado(t="Posada", m="Viernes", f=BUCKET_URL)).body.decode()
    assert 'class="con-fondo"' in con and BUCKET_URL in con
    ajeno = asyncio.run(sync_mod.comunicado(t="Posada", m="Viernes", f="https://evil.example/x.jpg")).body.decode()
    assert "evil.example" not in ajeno and 'class=""' in ajeno
    inyeccion = asyncio.run(sync_mod.comunicado(t="x", m="y", f=BUCKET_URL + '");}body{x:"')).body.decode()
    assert "body{x" not in inyeccion


def test_sync_lleva_el_fondo_a_la_lamina_y_a_la_pantalla(monkeypatch):
    monkeypatch.setattr(sync_mod.settings, "gcs_assets_bucket", "bucket-prod")
    url = sync_mod.comunicado_url("https://b/", "T", "M", BUCKET_URL)
    assert "f=https%3A%2F%2Fstorage.googleapis.com%2Fbucket-prod%2Ffondos%2Fnavidad.jpg" in url
    assert "f=" not in sync_mod.comunicado_url("https://b/", "T", "M")
    req = sync_mod.SyncRequest(grupos=[], items=[{"id": "C-9", "type": "link", "url": url, "grupos": ["culiacan"],
                                                   "fondoUrl": BUCKET_URL}])
    plan = sync_mod.plan_sync(req, groups={"culiacan": {"groupId": "culiacan", "playlistId": "pl-sheet-culiacan"}},
                              playlists={}, base_url="https://b/")
    assert plan["write_playlists"]["pl-sheet-culiacan"]["items"][0]["fondoUrl"] == BUCKET_URL


def test_fondo_solo_en_comunicado_o_evento(sheet):
    c = cliente("rh")
    base = {"titulo": "x", "pantallas": ["Todas"], "fondoUrl": BUCKET_URL}
    assert c.post("/rh/publicaciones", json={**base, "tipo": "Comunicado", "texto": "y"}).status_code == 200
    assert sheet[-1]["datos"]["fondoUrl"] == BUCKET_URL
    assert c.post("/rh/publicaciones", json={**base, "tipo": "Foto",
                                             "archivoUrl": "https://storage.googleapis.com/bucket-prod/a.jpg"}).status_code == 400
    assert c.post("/rh/publicaciones", json={**base, "tipo": "Evento", "fondoUrl": "https://evil.example/x.jpg"}).status_code == 400


class FondosRepo(FakeRepo):
    def __init__(self):
        super().__init__()
        self.fondos = {
            "f-fab": {"nombre": "Verde Capta", "url": BUCKET_URL, "tipo": "fabrica", "orden": 1},
            "f-ana": {"nombre": "Mío", "url": BUCKET_URL, "tipo": "subido", "creadoPor": "ana@outlook.com"},
        }

    async def list_fondos(self):
        return [{**v, "fondoId": k} for k, v in self.fondos.items()]

    async def get_fondo(self, fid):
        return {**self.fondos[fid], "fondoId": fid} if fid in self.fondos else None

    async def create_fondo(self, fid, fields):
        self.fondos[fid] = fields

    async def delete_fondo(self, fid):
        self.fondos.pop(fid, None)


def test_galeria_de_fondos_permisos():
    repo = FondosRepo()
    ana, beto = cliente("rh", repo=repo), cliente("rh", email="beto@outlook.com", repo=repo)
    lista = ana.get("/rh/fondos").json()
    assert [f["fondoId"] for f in lista] == ["f-fab", "f-ana"]  # fábrica primero
    r = beto.post("/rh/fondos", json={"nombre": "Navidad", "url": BUCKET_URL})
    assert r.status_code == 200 and repo.fondos[r.json()["fondoId"]]["creadoPor"] == "beto@outlook.com"
    assert ana.post("/rh/fondos", json={"nombre": "x", "url": "https://evil.example/x.jpg"}).status_code == 400
    assert ana.delete("/rh/fondos/f-fab").status_code == 400          # de fábrica: no
    assert beto.delete("/rh/fondos/f-ana").status_code == 403         # de otra persona: no
    assert ana.delete("/rh/fondos/f-ana").status_code == 200 and "f-ana" not in repo.fondos
    assert cliente("lectura", repo=repo).post("/rh/fondos", json={"nombre": "x", "url": BUCKET_URL}).status_code == 403


def test_si_firebase_falla_responde_mensaje_claro_y_no_guarda(monkeypatch):
    def falla(email, nombre):
        raise RuntimeError("INSUFFICIENT_PERMISSION")
    monkeypatch.setattr(panel, "_asegurar_cuenta_firebase", falla)
    repo = FakeRepo()
    c = cliente("admin", email="jefe@gmail.com", repo=repo)
    c.app.dependency_overrides[deps.get_current_admin] = lambda: deps.AdminUser("u", "jefe@gmail.com", "admin")
    r = c.post("/admin/usuarios", json={"email": "toño@captasoluciones.com", "rol": "admin"})
    assert r.status_code == 503 and "Firebase" in r.json()["detail"] and not repo.users


def test_link_de_contrasena_para_mandarlo_a_mano(monkeypatch):
    vistos = {}

    def generar(email, ajustes):
        vistos["email"], vistos["url"] = email, ajustes.url
        return "https://captasoluciones-signage.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=X"
    monkeypatch.setattr(panel.firebase_auth, "generate_password_reset_link", generar)
    monkeypatch.setattr(panel.settings, "cors_allow_origins", "https://captasoluciones-signage.web.app")
    repo = FakeRepo({"ana@outlook.com": {"rol": "rh", "activo": True}, "baja@outlook.com": {"rol": "rh", "activo": False}})
    c = cliente("admin", email="jefe@gmail.com", repo=repo)
    c.app.dependency_overrides[deps.get_current_admin] = lambda: deps.AdminUser("u", "jefe@gmail.com", "admin")
    r = c.post("/admin/usuarios/Ana@Outlook.com/link-contrasena", headers={"Origin": "https://evil.example"})
    assert r.status_code == 200 and r.json()["link"].endswith("&lang=es")
    assert vistos == {"email": "ana@outlook.com", "url": "https://captasoluciones-signage.web.app/login"}  # origen ajeno -> panel oficial
    assert c.post("/admin/usuarios/baja@outlook.com/link-contrasena").status_code == 404
    assert c.post("/admin/usuarios/nadie@outlook.com/link-contrasena").status_code == 404
    assert cliente("rh").post("/admin/usuarios/ana@outlook.com/link-contrasena").status_code == 403
