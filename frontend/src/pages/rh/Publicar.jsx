import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import {
  canvasToJpegBlob, loadImageFromFile, renderAnnouncementSlide, renderFlashySlide, renderPhotoSlide,
} from "../../utils/slideComposer";
import FondoSelector from "./FondoSelector";
import PreviewTV from "./PreviewTV";
import { DIAS_OPCIONES, TODAS, comoDataUrl, msgError, paraPantalla } from "./comun";
import "./rh.css";

const TIPOS = [
  { id: "Foto", emoji: "🖼️", desc: "Una foto con su título. El panel arma la lámina por ti." },
  { id: "Video", emoji: "🎬", desc: "Un video corto (MP4, máx. 25 MB)." },
  { id: "Comunicado", emoji: "📝", desc: "Solo texto: título y mensaje. Sale con el diseño de Capta." },
  { id: "Evento", emoji: "🎉", desc: "Con cuenta regresiva, fecha, hora y lugar. Se retira solo." },
];
const ESTILOS = [
  { id: "foto", txt: "Foto con título" },
  { id: "aviso", txt: "Aviso (la imagen ya trae su texto)" },
  { id: "llamativo", txt: "Llamativo (colores de fondo)" },
];
const VACIO = { titulo: "", subtitulo: "", texto: "", fecha: "", hora: "", lugar: "", frase: "", estilo: "foto",
  desde: "", hasta: "", dias: "Todos" };
const MAX_MB = 25;
const sinAcentos = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function Publicar() {
  const [tipo, setTipo] = useState("Foto");
  const [f, setF] = useState(VACIO);
  const [pantallasDisp, setPantallasDisp] = useState([]);
  const [pantallas, setPantallas] = useState([]);
  const [busca, setBusca] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [img, setImg] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [fotoUrl, setFotoUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [paso, setPaso] = useState("");
  const [listo, setListo] = useState(null);
  const [error, setError] = useState("");
  const [fondo, setFondo] = useState("");
  const canvasRef = useRef(null);
  const navigate = useNavigate();
  const conFondo = tipo === "Comunicado" || tipo === "Evento";
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    api.rhPantallas().then((r) => setPantallasDisp(r.pantallas || [])).catch((e) => setError(msgError(e)));
  }, []);

  // Foto: la lámina se compone con el mismo motor de "Crear contenido".
  useEffect(() => {
    if (tipo !== "Foto") return;
    if (!img) { setFotoUrl(""); return; }
    const c = canvasRef.current || (canvasRef.current = document.createElement("canvas"));
    if (f.estilo === "aviso") renderAnnouncementSlide(c, img, f.titulo);
    else if (f.estilo === "llamativo") renderFlashySlide(c, img, f.titulo || "¡Entérate!", 0);
    else renderPhotoSlide(c, img, f.titulo, f.subtitulo);
    setFotoUrl(c.toDataURL("image/jpeg", 0.85));
  }, [tipo, img, f.titulo, f.subtitulo, f.estilo]);

  function cambiarTipo(t) {
    setTipo(t); setImg(null); setArchivo(null); setFotoUrl(""); setVideoUrl(""); setListo(null); setError("");
    if (t !== "Comunicado" && t !== "Evento") setFondo("");
  }

  async function elegirArchivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`El archivo pasa de ${MAX_MB} MB.`);
    if (tipo === "Video") {
      if (file.type !== "video/mp4") return setError("El video debe ser MP4.");
      setArchivo(file); setVideoUrl(URL.createObjectURL(file));
    } else {
      if (!/^image\/(jpeg|png)$/.test(file.type)) return setError("La foto debe ser JPG o PNG.");
      if (tipo === "Evento") { setArchivo(file); setFotoUrl(URL.createObjectURL(file)); }
      else setImg(await loadImageFromFile(file));
    }
  }

  const todas = pantallas.includes(TODAS);
  const sucursales = pantallasDisp.filter((n) => n !== TODAS);
  const opciones = useMemo(() => {
    const q = sinAcentos(busca.trim());
    return sucursales.filter((n) => !q || sinAcentos(n).includes(q));
  }, [busca, pantallasDisp]); // eslint-disable-line react-hooks/exhaustive-deps
  const alternar = (n) => setPantallas((l) => (l.includes(n) ? l.filter((x) => x !== n) : [...l.filter((x) => x !== TODAS), n]));

  async function subir(blob, nombre, contentType) {
    const firma = await api.rhUploadUrl(nombre, contentType);
    await api.uploadToSignedUrl(firma.uploadUrl, blob, contentType);
    return firma.cdnUrl;
  }

  async function publicar() {
    setError(""); setListo(null);
    if (!f.titulo.trim()) return setError("Falta el título.");
    if (!pantallas.length) return setError("Elige al menos una pantalla.");
    if (tipo === "Comunicado" && !f.texto.trim()) return setError("Falta el mensaje del comunicado.");
    if (tipo === "Evento" && !f.fecha) return setError("El evento necesita fecha.");
    if ((tipo === "Foto" && !img) || (tipo === "Video" && !archivo)) return setError("Falta subir el archivo.");
    try {
      let archivoUrl = "";
      if (tipo === "Foto") {
        setPaso("Subiendo la lámina…");
        archivoUrl = await subir(await canvasToJpegBlob(canvasRef.current, 0.9), "lamina.jpg", "image/jpeg");
      } else if (archivo) {
        setPaso(tipo === "Video" ? "Subiendo el video…" : "Subiendo la foto…");
        archivoUrl = await subir(archivo, archivo.name, archivo.type);
      }
      setPaso("Guardando y publicando…");
      const r = await api.rhPublicar({
        tipo, titulo: f.titulo.trim(), texto: (tipo === "Foto" ? "" : f.texto).trim(), pantallas, archivoUrl,
        desde: f.desde, hasta: f.hasta || (tipo === "Evento" ? f.fecha : ""), dias: f.dias,
        eventoFecha: tipo === "Evento" ? f.fecha : "", eventoHora: tipo === "Evento" ? f.hora : "",
        eventoLugar: tipo === "Evento" ? f.lugar : "", eventoFrase: tipo === "Evento" ? f.frase : "",
        fondoUrl: conFondo ? fondo : "",
      });
      setListo({ ...r, pantallas });
      setF(VACIO); setPantallas([]); setImg(null); setArchivo(null); setFotoUrl(""); setVideoUrl(""); setFondo("");
    } catch (e) {
      setError(msgError(e));
    } finally {
      setPaso("");
    }
  }

  const pub = { tipo, ...f, pantallas, fondoUrl: conFondo ? fondo : "" };

  // Lleva el borrador (sin publicarlo) a la Vista previa, dentro de la pantalla real de la sucursal.
  async function verEnPantalla() {
    setError("");
    if (!f.titulo.trim()) return setError("Escribe al menos el título para verlo en la pantalla.");
    if (tipo === "Video") return setError("El video se ve en el recuadro de la derecha; en la pantalla real se ve ya publicado.");
    let foto = "";
    if (tipo === "Foto") foto = fotoUrl;
    else if (tipo === "Evento" && archivo) foto = await comoDataUrl(archivo);
    const item = paraPantalla({ ...pub, texto: tipo === "Foto" ? "" : f.texto }, { fotoUrl: foto });
    try { sessionStorage.setItem("cv-borrador", JSON.stringify(item)); } catch { return setError("La foto es muy pesada para la vista previa."); }
    const destino = pantallas.find((n) => n !== TODAS && n !== "Oficina RH") || "";
    navigate("/rh/vista-previa?borrador=1" + (destino ? "&s=" + encodeURIComponent(destino) : ""));
  }
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Publicar en pantallas</h1>
          <p className="page-sub">Fotos, videos, comunicados y eventos para las TVs de las sucursales. Sale en unos minutos.</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {listo && (
        <div className="panel success-panel">
          ¡Listo! Quedó registrado como <b>{listo.id}</b> en {listo.pantallas.includes(TODAS) ? "todas las pantallas" : listo.pantallas.join(", ")}.
          {listo.sincronizacion && <> ({String(listo.sincronizacion)})</>}{" "}
          <Link to="/rh/publicaciones">Ver publicaciones</Link>
        </div>
      )}

      <div className="studio-grid">
        <div className="panel studio-form">
          <div className="studio-field">
            <span className="modal-field-label">1. ¿Qué quieres publicar?</span>
            <div className="studio-mode-grid">
              {TIPOS.map((t) => (
                <button key={t.id} type="button" className={"studio-mode-card" + (tipo === t.id ? " active" : "")} onClick={() => cambiarTipo(t.id)}>
                  <span className="studio-mode-emoji">{t.emoji}</span>
                  <span className="studio-mode-title">{t.id}</span>
                  <span className="studio-mode-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <span className="modal-field-label">2. Contenido</span>
          {(tipo === "Foto" || tipo === "Video" || tipo === "Evento") && (
            <label className="studio-field">
              <span className="hint">{tipo === "Evento" ? "Foto o flyer (opcional, JPG o PNG)" : tipo === "Video" ? "Video MP4 horizontal, máx. 25 MB" : "Foto JPG o PNG, de preferencia horizontal"}</span>
              <input key={tipo} type="file" className="input" accept={tipo === "Video" ? "video/mp4" : "image/jpeg,image/png"} onChange={elegirArchivo} />
            </label>
          )}
          <label className="studio-field">
            <span className="hint">Título</span>
            <input className="input" value={f.titulo} onChange={set("titulo")} maxLength={200}
              placeholder={tipo === "Evento" ? "Ej. ¡Te invitamos a nuestra convivencia mensual!" : tipo === "Comunicado" ? "Ej. Pago de nómina" : "Ej. Cumpleañeros de octubre"} />
          </label>
          {tipo === "Foto" && (
            <>
              <label className="studio-field"><span className="hint">Subtítulo (opcional, va dentro de la lámina)</span>
                <input className="input" value={f.subtitulo} onChange={set("subtitulo")} placeholder="Ej. ¡Felicidades a todo el equipo!" /></label>
              <div className="studio-field"><span className="hint">Estilo de la lámina</span>
                <div className="demo-segmento">{ESTILOS.map((e) => (
                  <button key={e.id} type="button" className={f.estilo === e.id ? "on" : ""} onClick={() => setF((x) => ({ ...x, estilo: e.id }))}>{e.txt}</button>
                ))}</div></div>
            </>
          )}
          {tipo === "Comunicado" && (
            <label className="studio-field"><span className="hint">Mensaje ({f.texto.length}/300)</span>
              <textarea className="input" rows={4} maxLength={300} value={f.texto} onChange={set("texto")} placeholder="Escribe el mensaje…" /></label>
          )}
          {tipo === "Evento" && (
            <>
              <label className="studio-field"><span className="hint">Subtítulo (opcional)</span>
                <input className="input" value={f.texto} onChange={set("texto")} placeholder="Ej. Seguimos cuidando el bienestar del equipo" /></label>
              <div className="demo-fila3">
                <label className="studio-field"><span className="hint">Fecha</span><input type="date" className="input" value={f.fecha} onChange={set("fecha")} /></label>
                <label className="studio-field"><span className="hint">Hora</span><input type="time" className="input" value={f.hora} onChange={set("hora")} /></label>
                <label className="studio-field"><span className="hint">Lugar</span><input className="input" value={f.lugar} onChange={set("lugar")} placeholder="Ej. Corporativo" /></label>
              </div>
              <label className="studio-field"><span className="hint">Frase final</span>
                <input className="input" value={f.frase} onChange={set("frase")} placeholder="¡Los esperamos!" /></label>
            </>
          )}

          {conFondo && <FondoSelector value={fondo} onChange={setFondo} />}

          <span className="modal-field-label">3. ¿En qué pantallas?</span>
          <div className="demo-multi">
            <div className="demo-chips" onClick={() => setAbierto(true)}>
              {pantallas.length ? pantallas.map((n) => (
                <span key={n} className="demo-chip">{n}<button type="button" onClick={(e) => { e.stopPropagation(); alternar(n); }}>×</button></span>
              )) : <span className="hint">Elige una o varias…</span>}
            </div>
            {abierto && (
              <div className="demo-drop">
                <input className="input" autoFocus placeholder="Buscar (ej. maz)" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {pantallasDisp.includes(TODAS) && (
                  <label className="checkbox-label demo-todas">
                    <input type="checkbox" checked={todas} onChange={() => setPantallas(todas ? [] : [TODAS])} /> Todas las pantallas
                  </label>
                )}
                <div className="demo-opciones">
                  {opciones.map((n) => (
                    <label key={n} className="checkbox-label">
                      <input type="checkbox" disabled={todas} checked={todas || pantallas.includes(n)} onChange={() => alternar(n)} /> {n}
                    </label>
                  ))}
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setAbierto(false)}>Listo</button>
              </div>
            )}
          </div>

          <span className="modal-field-label">4. ¿Cuándo? (opcional)</span>
          <div className="demo-fila3">
            <label className="studio-field"><span className="hint">Desde</span><input type="date" className="input" value={f.desde} onChange={set("desde")} /></label>
            <label className="studio-field"><span className="hint">Hasta</span><input type="date" className="input" value={f.hasta} onChange={set("hasta")} /></label>
            <label className="studio-field"><span className="hint">Días</span>
              <select className="input" value={f.dias} onChange={set("dias")}>{DIAS_OPCIONES.map((d) => <option key={d}>{d}</option>)}</select></label>
          </div>
          <p className="hint">Vacío = desde hoy y sin fecha de fin. Un evento se retira solo al terminar su día.</p>

          <div className="form-actions">
            <button type="button" className="btn" onClick={verEnPantalla} disabled={!!paso}>Verlo en la pantalla real</button>
            <button type="button" className="btn btn-primary" onClick={publicar} disabled={!!paso}>{paso || "Publicar"}</button>
          </div>
        </div>

        <div className="studio-preview-col">
          <div className="panel">
            <span className="modal-field-label">Así se verá en la TV</span>
            <PreviewTV pub={pub} fotoUrl={fotoUrl} videoUrl={videoUrl} />
            <p className="hint">En las sucursales con pantalla de indicadores sale dentro de la vuelta, en las pantallas "¡ENTÉRATE!".</p>
          </div>
        </div>
      </div>
    </div>
  );
}
