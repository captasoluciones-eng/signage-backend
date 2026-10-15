/* Utilidades de la sección de Recursos Humanos. */

export const TODAS = "Todas";
export const DIAS_OPCIONES = ["Todos", "Lunes a viernes", "Fines de semana"];
export const EMOJI = { Foto: "🖼️", Video: "🎬", Comunicado: "📝", Evento: "🎉" };

/** Mensaje de error sin el código HTTP del cliente ("400 Falta el título." -> "Falta el título."). */
export const msgError = (e) => String(e?.message || e || "Error").replace(/^\d{3}\s+/, "");

/** Categoría y color a partir de la columna Estado del Sheet. */
export function categoriaEstado(p) {
  const e = String(p.estado || "");
  if (!p.activo || e.startsWith("Inactivo")) return { cat: "Apagado", tono: "muted" };
  if (e.startsWith("Publicado")) return { cat: "Publicado", tono: "ok" };
  if (e.startsWith("Programado")) return { cat: "Programado", tono: "warn" };
  if (e.startsWith("Vencido")) return { cat: "Vencido", tono: "danger" };
  if (e.startsWith("❌")) return { cat: "Con error", tono: "danger" };
  return { cat: "Pendiente", tono: "warn" }; // "Pendiente de publicar", "⚠️ No se pudo publicar…"
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]}` : "";
}

/** Link de la pantalla real de una sucursal. Lo arma el backend (/rh/sucursales, con el token
 * del kiosco, que no vive en el código del panel); aquí solo se agregan las opciones de vista. */
export function urlPantalla(s, { intro = false } = {}) {
  return (s.url || "") + (intro ? "" : "&intro=0") + "&horario=0";
}

export const aplicaA = (p, nombre) => p.pantallas.includes(TODAS) || p.pantallas.includes(nombre);

/** Publicación del Sheet -> lo que entiende PreviewTV. */
export const paraPreview = (p) => ({
  tipo: p.tipo, titulo: p.titulo, texto: p.texto,
  fecha: p.eventoFecha, hora: p.eventoHora, lugar: p.eventoLugar, frase: p.eventoFrase,
});

/** Liga de la imagen ya publicada (para miniatura/vista previa). */
export function urlImagen(p) {
  const u = p.url || p.archivo || "";
  return /^https:\/\/storage\.googleapis\.com\//.test(u) ? u : "";
}

/** Origen de la pantalla de las TVs (para hablar con ella dentro del iframe de la Vista previa). */
export const ORIGEN_PANTALLA = "https://kiosko.bts-captasoluciones.site";

/** Publicación (del Sheet o un borrador de "Publicar") -> elemento de RH como lo dibuja la pantalla. */
export function paraPantalla(p, { fotoUrl, archivoUrl } = {}) {
  const base = {
    id: "vista-" + (p.id || "borrador"), titulo: p.titulo, texto: p.texto,
    fondoUrl: p.fondoUrl || null, durationSec: p.segundos || null,
  };
  if (p.tipo === "Comunicado") return { ...base, tipo: "comunicado" };
  if (p.tipo === "Evento") {
    return {
      ...base, tipo: "evento",
      evento: { fotoUrl: fotoUrl || urlImagen(p) || null, fecha: p.eventoFecha || p.fecha, hora: p.eventoHora || p.hora,
        lugar: p.eventoLugar || p.lugar, cta: p.eventoFrase || p.frase },
    };
  }
  if (p.tipo === "Video") return { ...base, tipo: "video", url: archivoUrl || p.url };
  return { ...base, tipo: "imagen", url: fotoUrl || urlImagen(p) };
}

/** Lee un archivo como data: URL (para mostrar un borrador en la pantalla real, que vive en otro dominio). */
export const comoDataUrl = (file) =>
  new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = mal; r.readAsDataURL(file); });
