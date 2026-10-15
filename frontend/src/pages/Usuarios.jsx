import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

const ROLES = [
  { id: "rh", txt: "Recursos humanos", desc: "Publica, apaga y cambia fechas de lo de RH. Ve la vista previa." },
  { id: "lectura", txt: "Solo consulta", desc: "Ve publicaciones y vista previa, sin poder cambiar nada." },
  { id: "admin", txt: "Administrador", desc: "Todo el panel: pantallas, grupos, playlists y usuarios." },
];
const ROL_TXT = Object.fromEntries(ROLES.map((r) => [r.id, r.txt]));
const msgError = (e) => String(e?.message || e).replace(/^\d{3}\s+/, "");

export default function Usuarios() {
  const { user, enviarCorreoContrasena } = useAuth();
  const [usuarios, setUsuarios] = useState(null);
  const [nuevo, setNuevo] = useState({ email: "", nombre: "", rol: "rh" });
  const [guardando, setGuardando] = useState("");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState(null); // {email, link}
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setUsuarios(await api.listUsuarios());
    } catch (e) {
      setError(msgError(e));
      setUsuarios((u) => u || []);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function correo(email) {
    await enviarCorreoContrasena(email);
    return `Le enviamos a ${email} un correo para crear su contraseña (si no le llega, que revise "correo no deseado").`;
  }

  async function alta(e) {
    e.preventDefault();
    setError(""); setAviso(""); setGuardando("alta");
    try {
      const r = await api.crearUsuario({ ...nuevo, email: nuevo.email.trim() });
      let txt = `${r.usuario.email} quedó dado de alta como ${ROL_TXT[r.usuario.rol]}.`;
      if (r.cuentaNueva) txt += " " + (await correo(r.usuario.email));
      else txt += " Ya tenía cuenta: puede entrar con su contraseña de siempre (o con \"Primera vez u olvidé mi contraseña\").";
      setAviso(txt);
      await verLink(r.usuario.email);
      setNuevo({ email: "", nombre: "", rol: "rh" });
      await cargar();
    } catch (e2) {
      setError(msgError(e2));
    } finally {
      setGuardando("");
    }
  }

  async function cambiar(u, cambios, ok) {
    setError(""); setAviso(""); setGuardando(u.email);
    try {
      await api.editarUsuario(u.email, cambios);
      setAviso(ok);
      await cargar();
    } catch (e) {
      setError(msgError(e));
    } finally {
      setGuardando("");
    }
  }

  // Link para crear contraseña, para mandarlo a mano (WhatsApp, Outlook propio…): el correo
  // automático de Firebase a veces se queda en cuarentena en correos de empresa.
  async function verLink(email) {
    setError(""); setCopiado(false);
    try { setLink(await api.linkContrasena(email)); } catch (e) { setError(msgError(e)); }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(link.link); setCopiado(true); } catch { setCopiado(false); }
  }

  async function reenviar(u) {
    setError(""); setAviso("");
    try { setAviso(await correo(u.email)); } catch (e) { setError(msgError(e)); }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Usuarios</h1>
          <p className="page-sub">Quién puede entrar al panel y qué puede hacer. Sirve cualquier correo (Outlook, Gmail, de la empresa).</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {aviso && <div className="panel success-panel">{aviso}</div>}
      {link && (
        <div className="panel usuarios-link">
          <span className="modal-field-label">Link para que {link.email} cree su contraseña</span>
          <div className="usuarios-link-fila">
            <input className="input" readOnly value={link.link} onFocus={(e) => e.target.select()} />
            <button className="btn btn-primary btn-sm" onClick={copiar}>{copiado ? "¡Copiado!" : "Copiar"}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setLink(null)}>Cerrar</button>
          </div>
          <p className="hint">Mándaselo por WhatsApp o desde tu correo, por si el automático no le llega. Sirve una sola vez y caduca en unas horas; si caduca, genera otro.</p>
        </div>
      )}

      <form className="panel usuarios-alta" onSubmit={alta}>
        <span className="modal-field-label">Dar de alta</span>
        <div className="usuarios-fila">
          <input className="input" type="email" required placeholder="correo@outlook.com" value={nuevo.email}
            onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} />
          <input className="input" placeholder="Nombre (opcional)" value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
          <select className="input" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.txt}</option>)}
          </select>
          <button className="btn btn-primary" type="submit" disabled={guardando === "alta"}>{guardando === "alta" ? "Guardando…" : "Dar de alta"}</button>
        </div>
        <p className="hint">{ROLES.find((r) => r.id === nuevo.rol)?.desc} Le llega un correo para crear su contraseña; también puede entrar con Google si es una cuenta de Google.</p>
      </form>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Correo</th><th>Rol</th><th>Estado</th><th>Alta</th><th></th></tr></thead>
          <tbody>
            {usuarios === null && <tr><td colSpan={5} className="empty-state">Cargando…</td></tr>}
            {(usuarios || []).map((u) => (
              <tr key={u.email}>
                <td><div className="cell-strong">{u.email}</div>{u.nombre && <div className="cell-muted">{u.nombre}</div>}</td>
                <td>
                  {u.superadmin ? <span className="badge">Administrador (fijo)</span> : (
                    <select className="input input-sm" value={u.rol} disabled={guardando === u.email || u.email === user?.email}
                      onChange={(e) => cambiar(u, { rol: e.target.value }, `${u.email} ahora es ${ROL_TXT[e.target.value]}.`)}>
                      {ROLES.map((r) => <option key={r.id} value={r.id}>{r.txt}</option>)}
                    </select>
                  )}
                </td>
                <td>{u.activo ? <span className="status-pill is-online">Activo</span> : <span className="status-pill is-offline">Desactivado</span>}</td>
                <td className="cell-muted">{u.creado ? new Date(u.creado).toLocaleDateString("es-MX") : "—"}{u.creadoPor ? <><br />por {u.creadoPor}</> : null}</td>
                <td className="row-actions">
                  {!u.superadmin && u.email !== user?.email && (
                    <button className="btn btn-sm" disabled={guardando === u.email}
                      onClick={() => cambiar(u, { activo: !u.activo }, `${u.email} ${u.activo ? "ya no puede entrar" : "puede volver a entrar"}.`)}>
                      {u.activo ? "Desactivar" : "Activar"}</button>
                  )}
                  {!u.superadmin && u.activo && <button className="btn btn-sm" onClick={() => verLink(u.email)}>Link de contraseña</button>}
                  {!u.superadmin && u.activo && <button className="btn btn-ghost btn-sm" onClick={() => reenviar(u)}>Reenviar correo</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
