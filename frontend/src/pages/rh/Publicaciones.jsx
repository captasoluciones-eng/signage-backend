import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import Modal from "../../components/Modal";
import { useAuth } from "../../context/AuthContext";
import { downloadCsv } from "../../utils/csv";
import PreviewTV from "./PreviewTV";
import { DIAS_OPCIONES, EMOJI, TODAS, categoriaEstado, fechaCorta, msgError, paraPreview, urlImagen } from "./comun";
import "./rh.css";

const CATEGORIAS = [
  ["Publicado", "ok"], ["Programado", "warn"], ["Pendiente", "warn"], ["Vencido", "danger"], ["Con error", "danger"], ["Apagado", "muted"],
];

export default function Publicaciones() {
  const { rol } = useAuth();
  const puedeEditar = rol === "admin" || rol === "rh";
  const [pubs, setPubs] = useState(null);
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [editando, setEditando] = useState(null);
  const [viendo, setViendo] = useState(null);
  const [trabajando, setTrabajando] = useState("");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const r = await api.rhPublicaciones();
      setPubs(r.publicaciones.map((p) => ({ ...p, est: categoriaEstado(p) })));
      setError("");
    } catch (e) {
      setError(msgError(e));
      setPubs((x) => x || []);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => (pubs || []).filter((p) =>
    (!fCat || p.est.cat === fCat) && (!fTipo || p.tipo === fTipo) &&
    (!q || (p.titulo + " " + p.id + " " + p.pantallas.join(" ") + " " + p.publico).toLowerCase().includes(q.toLowerCase()))), [pubs, q, fCat, fTipo]);
  const cuenta = (c) => (pubs || []).filter((p) => p.est.cat === c).length;

  async function accion(id, txt, fn, ok) {
    setTrabajando(id + txt); setError(""); setAviso("");
    try {
      await fn();
      setAviso(ok);
      await cargar();
    } catch (e) {
      setError(msgError(e));
    } finally {
      setTrabajando("");
    }
  }

  function exportar() {
    downloadCsv("publicaciones_pantallas.csv", filas.map((p) => ({
      ID: p.id, Tipo: p.tipo, Titulo: p.titulo, Pantallas: p.pantallas.join(" | "), Desde: p.desde, Hasta: p.hasta,
      Dias: p.dias, Estado: p.estado, Publico: p.publico, Activo: p.activo ? "Sí" : "No",
    })));
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Publicaciones</h1>
          <p className="page-sub">Todo lo que está, estará o estuvo en las pantallas. Viene del Sheet "Contenido de Pantallas".</p>
        </div>
        {puedeEditar && <Link className="btn btn-primary" to="/rh/publicar">+ Publicar</Link>}
      </div>

      <div className="stat-grid">
        {CATEGORIAS.filter(([c]) => cuenta(c) || ["Publicado", "Programado", "Vencido", "Apagado"].includes(c)).map(([c, tono]) => (
          <button key={c} type="button" className={`stat-card demo-stat tone-${tono}` + (fCat === c ? " demo-stat-on" : "")} onClick={() => setFCat(fCat === c ? "" : c)}>
            <div className="stat-top"><div className="stat-value">{pubs ? cuenta(c) : "…"}</div></div>
            <div className="stat-label">{c}</div>
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {aviso && <div className="panel success-panel">{aviso}</div>}

      <div className="toolbar demo-toolbar">
        <input className="input search-input" placeholder="Buscar por título, ID, sucursal o quién publicó…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input input-sm" value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Todos los tipos</option>{Object.keys(EMOJI).map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={cargar}>Actualizar</button>
        <button className="btn btn-sm" onClick={exportar} disabled={!filas.length}>Descargar CSV</button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th></th><th>Publicación</th><th>Pantallas</th><th>Vigencia</th><th>Estado</th><th>Publicó</th>{puedeEditar && <th></th>}</tr></thead>
          <tbody>
            {pubs === null && <tr><td colSpan={7} className="empty-state">Cargando del Sheet…</td></tr>}
            {filas.map((p) => (
              <tr key={p.id}>
                <td>
                  <button type="button" className="demo-mini" onClick={() => setViendo(p)} title="Ver cómo se ve">
                    {(p.tipo === "Foto" || p.tipo === "Evento") && urlImagen(p) ? <img alt="" src={urlImagen(p)} /> : <span>{EMOJI[p.tipo]}</span>}
                  </button>
                </td>
                <td>
                  <div className="cell-strong">{p.titulo}</div>
                  <div className="cell-muted">{p.id} · {p.tipo}{p.tipo === "Evento" && p.eventoFecha ? ` · ${fechaCorta(p.eventoFecha)} ${p.eventoHora || ""}` : ""}</div>
                </td>
                <td>{p.pantallas.includes(TODAS) ? <span className="badge">Todas</span>
                  : <span title={p.pantallas.join(", ")}>{p.pantallas.slice(0, 2).join(", ")}{p.pantallas.length > 2 ? ` +${p.pantallas.length - 2}` : ""}</span>}</td>
                <td className="cell-muted">{p.desde ? fechaCorta(p.desde) : "Desde que se publicó"} → {p.hasta ? fechaCorta(p.hasta) : "sin fin"}<br />{p.dias}</td>
                <td><span className={"demo-pill tone-" + p.est.tono}>{p.est.cat}</span><div className="cell-muted demo-estado">{p.estado}</div></td>
                <td className="cell-muted">{p.publico || "—"}</td>
                {puedeEditar && (
                  <td className="row-actions">
                    <button className="btn btn-sm" disabled={!!trabajando}
                      onClick={() => accion(p.id, "act", () => api.rhActualizar(p.id, { activo: !p.activo }),
                        `${p.id} ${p.activo ? "apagada: deja de salir en las TVs en unos minutos" : "reactivada"}.`)}>
                      {trabajando === p.id + "act" ? "…" : p.activo ? "Apagar" : "Reactivar"}</button>
                    <button className="btn btn-sm" disabled={!!trabajando} onClick={() => setEditando(p)}>Fechas</button>
                    <button className="btn btn-ghost btn-sm" disabled={!!trabajando}
                      onClick={() => accion(p.id, "dup", () => api.rhDuplicar(p.id), `Se creó una copia apagada de ${p.id} para que la ajustes y la prendas.`)}>
                      {trabajando === p.id + "dup" ? "…" : "Duplicar"}</button>
                  </td>
                )}
              </tr>
            ))}
            {pubs && !filas.length && <tr><td colSpan={7} className="empty-state">No hay publicaciones con esos filtros.</td></tr>}
          </tbody>
        </table>
      </div>

      {editando && (
        <EditarFechas p={editando} onClose={() => setEditando(null)}
          onGuardar={(c) => { const id = editando.id; setEditando(null); accion(id, "fechas", () => api.rhActualizar(id, c), `Fechas de ${id} actualizadas.`); }} />
      )}
      {viendo && (
        <Modal title={viendo.titulo} description={`${viendo.id} · ${viendo.tipo} · ${viendo.estado}`} onClose={() => setViendo(null)}
          actions={<button className="btn" onClick={() => setViendo(null)}>Cerrar</button>}>
          <PreviewTV pub={paraPreview(viendo)} fotoUrl={urlImagen(viendo)} videoUrl={viendo.tipo === "Video" ? viendo.url : ""} />
        </Modal>
      )}
    </div>
  );
}

function EditarFechas({ p, onClose, onGuardar }) {
  const [desde, setDesde] = useState(p.desde || "");
  const [hasta, setHasta] = useState(p.hasta || "");
  const [dias, setDias] = useState(DIAS_OPCIONES.includes(p.dias) ? p.dias : "Todos");
  return (
    <Modal title="Cambiar fechas" description={`${p.id} · ${p.titulo}`} onClose={onClose}
      actions={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => onGuardar({ desde, hasta, dias })}>Guardar</button></>}>
      <div className="demo-fila3">
        <label className="studio-field"><span className="hint">Desde</span><input type="date" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="studio-field"><span className="hint">Hasta</span><input type="date" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="studio-field"><span className="hint">Días</span>
          <select className="input" value={dias} onChange={(e) => setDias(e.target.value)}>{DIAS_OPCIONES.map((d) => <option key={d}>{d}</option>)}</select></label>
      </div>
      <p className="hint">Deja una fecha vacía para quitarla.</p>
    </Modal>
  );
}
