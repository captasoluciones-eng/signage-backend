import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { EMOJI, ORIGEN_PANTALLA, aplicaA, categoriaEstado, fechaCorta, msgError, paraPantalla, urlPantalla } from "./comun";
import "./rh.css";

function hace(iso) {
  if (!iso) return "sin reportes";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

function leerBorrador() {
  try { return JSON.parse(sessionStorage.getItem("cv-borrador") || "null"); } catch { return null; }
}

// La pantalla real (la misma de las TVs) dentro de un iframe. El panel le manda órdenes con
// postMessage (siguiente, anterior, ir a una hoja, pausa, mostrar una publicación) y ella
// avisa en qué hoja va. Las TVs no reciben estas órdenes: siguen su vuelta normal.
export default function VistaPrevia() {
  const { rol } = useAuth();
  const [params, setParams] = useSearchParams();
  const [sucursales, setSucursales] = useState(null);
  const [pubs, setPubs] = useState([]);
  const [intro, setIntro] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [estado, setEstado] = useState(null); // {indice, pasos, pausa}
  const [borrador] = useState(() => (params.get("borrador") ? leerBorrador() : null));
  const [error, setError] = useState("");
  const marco = useRef(null);
  const borradorEnviado = useRef(false);

  useEffect(() => {
    api.rhSucursales().then((r) => setSucursales(r.sucursales)).catch((e) => { setError(msgError(e)); setSucursales([]); });
    api.rhPublicaciones().then((r) => setPubs(r.publicaciones)).catch(() => {});
  }, []);

  const enviar = useCallback((msg) => {
    const w = marco.current?.contentWindow;
    if (w) w.postMessage(msg, ORIGEN_PANTALLA);
  }, []);

  // Mensajes de la pantalla.
  useEffect(() => {
    function alRecibir(ev) {
      if (ev.origin !== ORIGEN_PANTALLA || !ev.data || ev.data.cv !== "estado") return;
      setEstado(ev.data);
    }
    window.addEventListener("message", alRecibir);
    return () => window.removeEventListener("message", alRecibir);
  }, []);

  // Al cargar la pantalla: saludarla (para que empiece a avisar) y, si viene un borrador de
  // "Publicar", mostrarlo de una vez.
  const alCargar = useCallback(() => {
    setEstado(null);
    borradorEnviado.current = false;
    let n = 0;
    const t = setInterval(() => {
      enviar({ cv: "hola" });
      if (++n >= 20) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [enviar]);
  useEffect(() => {
    if (estado && borrador && !borradorEnviado.current) {
      borradorEnviado.current = true;
      enviar({ cv: "rh", item: borrador });
    }
  }, [estado, borrador, enviar]);

  if (!sucursales) return <div className="center-page">Cargando sucursales…</div>;
  const nombre = params.get("s");
  const s = sucursales.find((x) => x.n === nombre) || sucursales.find((x) => x.tvs.length) || sucursales[0];
  if (!s) return <div className="error-banner">{error || "No hay sucursales configuradas."}</div>;

  const suyas = pubs.filter((p) => aplicaA(p, s.n));
  const visibles = suyas.filter((p) => ["Publicado", "Programado", "Pendiente"].includes(categoriaEstado(p).cat));
  const cambiarSucursal = (n) => setParams(borrador ? { s: n, borrador: "1" } : { s: n });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Vista previa</h1>
          <p className="page-sub">La pantalla real de cada sucursal. Adelanta, regresa o pausa las hojas, y ve cualquier publicación sin esperar su turno.</p>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {borrador && (
        <div className="panel vp-borrador">
          Estás viendo <b>tu borrador</b> ("{borrador.titulo}") en la pantalla de {s.n}. <b>Todavía no está publicado.</b>{" "}
          <Link to="/rh/publicar">Regresar a Publicar</Link>
        </div>
      )}

      <div className="toolbar demo-toolbar">
        <select className="input" value={s.n} onChange={(e) => cambiarSucursal(e.target.value)}>
          {sucursales.map((x) => <option key={x.g} value={x.n}>{x.n}{x.tvs.length ? " · con TV" : ""}</option>)}
        </select>
        <label className="checkbox-label"><input type="checkbox" checked={intro} onChange={(e) => setIntro(e.target.checked)} /> Con el video de intro</label>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setRecarga((r) => r + 1)}>Volver a empezar</button>
        <a className="btn btn-ghost btn-sm" href={urlPantalla(s, { intro })} target="_blank" rel="noreferrer">Abrir en pantalla completa</a>
      </div>

      <div className="demo-vp-grid">
        <div className="panel">
          <div className="demo-vp-marco">
            <iframe ref={marco} key={s.g + intro + recarga} title={"Pantalla " + s.n} src={urlPantalla(s, { intro })} allow="autoplay" onLoad={alCargar} />
          </div>

          <div className="vp-controles">
            <button className="btn btn-sm" disabled={!estado} onClick={() => enviar({ cv: "anterior" })}>◀ Anterior</button>
            <button className="btn btn-sm btn-primary" disabled={!estado} onClick={() => enviar({ cv: "pausa", on: !estado?.pausa })}>
              {estado?.pausa ? "▶ Continuar" : "⏸ Pausar"}
            </button>
            <button className="btn btn-sm" disabled={!estado} onClick={() => enviar({ cv: "siguiente" })}>Siguiente ▶</button>
            <span className="cell-muted">
              {estado ? `Hoja ${estado.indice + 1} de ${estado.pasos.length}${estado.pausa ? " · en pausa" : ""}` : "Conectando con la pantalla…"}
            </span>
          </div>
          {estado && (
            <div className="vp-pasos">
              {estado.pasos.map((p, i) => (
                <button key={i + p} type="button" className={"vp-paso" + (i === estado.indice ? " on" : "")} onClick={() => enviar({ cv: "ir", indice: i })}>
                  <small>{i + 1}</small>{p}
                </button>
              ))}
            </div>
          )}
          <p className="hint">Es la misma página que carga la TV, en vivo. Aquí se ignora el horario de encendido y los controles solo afectan esta vista, no las TVs.</p>
        </div>

        <div className="demo-vp-lado">
          <div className="panel">
            <span className="modal-field-label">TV de {s.n}</span>
            {s.tvs.length ? s.tvs.map((t) => (
              <div key={t.nombre} className="demo-tv-estado">
                <span className={"status-pill " + (t.online ? "is-online" : "is-offline")}>{t.online ? "En línea" : "Sin conexión"}</span>
                <div className="cell-strong">{t.nombre}</div>
                <div className="cell-muted">Último reporte {hace(t.lastSeen)}</div>
              </div>
            )) : (
              <div className="demo-tv-estado">
                <span className="status-pill is-offline">Sin TV vinculada</span>
                <div className="cell-muted">Cuando se instale y se vincule a {s.n}, aquí sale si está en línea.</div>
              </div>
            )}
          </div>
          <div className="panel">
            <span className="modal-field-label">De RH para {s.n} ({visibles.length})</span>
            {visibles.length ? visibles.map((p) => {
              const est = categoriaEstado(p);
              return (
                <div key={p.id} className="demo-vp-item vp-item">
                  <b>{EMOJI[p.tipo]} {p.titulo}</b>
                  <span className="cell-muted">{p.id} · {est.cat}{est.cat === "Programado" && p.desde ? " desde el " + fechaCorta(p.desde) : p.hasta ? " · hasta el " + fechaCorta(p.hasta) : ""}</span>
                  <button className="btn btn-ghost btn-sm" disabled={!estado} onClick={() => enviar({ cv: "rh", item: paraPantalla(p) })}>Ver en la pantalla</button>
                </div>
              );
            }) : <p className="hint">Nada de RH para esta sucursal.</p>}
            {rol !== "lectura" && <Link className="btn btn-sm" to="/rh/publicar">+ Publicar</Link>}
          </div>
        </div>
      </div>
    </div>
  );
}
