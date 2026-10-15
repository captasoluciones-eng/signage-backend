import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { msgError } from "./comun";

const MAX_MB = 10;

/** Galería de fondos para comunicados y eventos: de fábrica + los que sube RH.
 *  value = URL del fondo elegido ("" = diseño normal). */
export default function FondoSelector({ value, onChange }) {
  const { user, rol } = useAuth();
  const [fondos, setFondos] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [guardar, setGuardar] = useState(true);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");

  const cargar = () => api.rhFondos().then(setFondos).catch((e) => { setError(msgError(e)); setFondos([]); });
  useEffect(() => { cargar(); }, []);

  async function subir(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    if (!/^image\/(jpeg|png)$/.test(file.type)) return setError("El fondo debe ser JPG o PNG.");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`El fondo pasa de ${MAX_MB} MB.`);
    setSubiendo(true);
    try {
      const firma = await api.rhUploadUrl(file.name, file.type);
      await api.uploadToSignedUrl(firma.uploadUrl, file, file.type);
      if (guardar) {
        await api.rhGuardarFondo(nombre.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 80), firma.cdnUrl);
        setNombre("");
        await cargar();
      }
      onChange(firma.cdnUrl);
    } catch (e2) {
      setError(msgError(e2));
    } finally {
      setSubiendo(false);
    }
  }

  async function borrar(f, ev) {
    ev.stopPropagation();
    if (!window.confirm(`¿Quitar "${f.nombre}" de la galería? Lo ya publicado con este fondo no cambia.`)) return;
    try {
      await api.rhBorrarFondo(f.fondoId);
      if (value === f.url) onChange("");
      await cargar();
    } catch (e) {
      setError(msgError(e));
    }
  }

  const puedeBorrar = (f) => f.tipo !== "fabrica" && (rol === "admin" || f.creadoPor === user?.email);
  return (
    <div className="studio-field">
      <span className="hint">Fondo (opcional)</span>
      <div className="fondos-grid">
        <button type="button" className={"fondo-opcion fondo-ninguno" + (!value ? " on" : "")} onClick={() => onChange("")}>
          <span>Diseño normal</span>
        </button>
        {(fondos || []).map((f) => (
          <button key={f.fondoId} type="button" title={f.nombre + (f.tipo === "fabrica" ? "" : ` · subido por ${f.creadoPor}`)}
            className={"fondo-opcion" + (value === f.url ? " on" : "")} style={{ backgroundImage: `url("${f.url}")` }} onClick={() => onChange(f.url)}>
            <span>{f.nombre}</span>
            {puedeBorrar(f) && <i className="fondo-borrar" title="Quitar de la galería" onClick={(ev) => borrar(f, ev)}>×</i>}
          </button>
        ))}
        {value && !(fondos || []).some((f) => f.url === value) && (
          <button type="button" className="fondo-opcion on" style={{ backgroundImage: `url("${value}")` }}><span>Este fondo</span></button>
        )}
        {fondos === null && <span className="hint">Cargando fondos…</span>}
      </div>
      <div className="fondo-subir">
        <label className="btn btn-sm">
          {subiendo ? "Subiendo…" : "Subir fondo"}
          <input type="file" accept="image/jpeg,image/png" onChange={subir} disabled={subiendo} hidden />
        </label>
        <label className="checkbox-label"><input type="checkbox" checked={guardar} onChange={(e) => setGuardar(e.target.checked)} /> Guardarlo en la galería</label>
        {guardar && <input className="input input-sm" placeholder="Nombre (ej. Posada 2026)" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />}
      </div>
      <p className="hint">Horizontal, idealmente 1600×900. El texto va encima en una franja semitransparente para que se lea.</p>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
