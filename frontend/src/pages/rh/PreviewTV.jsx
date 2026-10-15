/* Cómo se verá una publicación en la TV (marco 16:9). Comunicado: la MISMA lámina
 * que genera el backend (/public/comunicado). Evento: réplica de la tarjeta de
 * evento de la pantalla, con cuenta regresiva. Foto: la lámina compuesta. */
import { useEffect, useRef, useState } from "react";

// La lámina del comunicado la dibuja el mismo backend al que habla el panel.
const BACKEND = import.meta.env.VITE_API_BASE_URL || "https://signage-backend-ckuqqiwiqa-uc.a.run.app";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const t = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function horaAmPm(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
  if (!m) return "";
  const h = +m[1];
  return `A partir de las ${h % 12 || 12}:${m[2]} ${h < 12 ? "a.m." : "p.m."}`;
}
function cuenta(fecha, hora) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || "");
  if (!m) return "—";
  const h = /^(\d{1,2}):(\d{2})/.exec(hora || "") || [0, 0, 0];
  const dif = new Date(+m[1], +m[2] - 1, +m[3], +h[1], +h[2]) - new Date();
  if (dif <= 0) return dif > -6 * 3600e3 ? "¡Hoy es el evento!" : "Evento finalizado";
  const min = Math.floor(dif / 60000);
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h ${min % 60}m`;
}

export default function PreviewTV({ pub, fotoUrl, videoUrl, compacto = false }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  // La lámina del backend está hecha para la TV (1600x900): se dibuja a ese tamaño y se escala.
  const pantallaRef = useRef(null);
  const [escala, setEscala] = useState(0.3);
  useEffect(() => {
    const el = pantallaRef.current;
    if (!el || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => setEscala(el.clientWidth / 1600));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pub?.tipo]);
  if (!pub) return <div className="tv-frame tv-vacio">Elige qué publicar</div>;

  let cuerpo;
  if (pub.tipo === "Comunicado") {
    const src = `${BACKEND}/public/comunicado?t=${encodeURIComponent(pub.titulo || "Título del comunicado")}&m=${encodeURIComponent(pub.texto || "Aquí va el mensaje.")}` +
      (pub.fondoUrl ? `&f=${encodeURIComponent(pub.fondoUrl)}` : "");
    cuerpo = <iframe title="Comunicado" className="tv-iframe" src={src} tabIndex={-1} style={{ transform: `scale(${escala})` }} />;
  } else if (pub.tipo === "Evento") {
    cuerpo = (
      <div className={"tv-evento" + (pub.fondoUrl ? " con-fondo" : "") + (pub.fondoUrl && !fotoUrl ? " solo" : "")}
        style={pub.fondoUrl ? { backgroundImage: `url("${pub.fondoUrl}")` } : undefined}>
        {!(pub.fondoUrl && !fotoUrl) && <div className="tv-ev-foto">{fotoUrl ? <img alt="" src={fotoUrl} /> : <span>RH</span>}</div>}
        <div className="tv-ev-info">
          <div className="tv-ev-tag">RECURSOS HUMANOS · EVENTO</div>
          <div className="tv-ev-titulo">{pub.titulo || "Nombre del evento"}</div>
          {pub.texto && <div className="tv-ev-sub">{pub.texto}</div>}
          <div className="tv-ev-cuenta"><small>FALTAN PARA EL EVENTO</small>{cuenta(pub.fecha, pub.hora)}</div>
          {pub.fecha && <div className="tv-ev-chip"><small>FECHA</small>{fechaLarga(pub.fecha)}</div>}
          {pub.hora && <div className="tv-ev-chip"><small>HORARIO</small>{horaAmPm(pub.hora)}</div>}
          {pub.lugar && <div className="tv-ev-chip"><small>LUGAR</small>{pub.lugar}</div>}
          <div className="tv-ev-cta">{pub.frase || "¡Los esperamos!"}</div>
        </div>
      </div>
    );
  } else if (pub.tipo === "Video") {
    cuerpo = videoUrl ? <video className="tv-media" src={videoUrl} muted autoPlay loop playsInline />
      : <div className="tv-placeholder">🎬<span>{pub.titulo || "Video"}</span></div>;
  } else {
    cuerpo = fotoUrl ? <img className="tv-media" alt="" src={fotoUrl} />
      : <div className="tv-placeholder">🖼️<span>{pub.titulo || "Foto"}</span></div>;
  }
  return (
    <div className={"tv-frame" + (compacto ? " tv-compacto" : "")}>
      <div className="tv-pantalla" ref={pantallaRef}>{cuerpo}</div>
    </div>
  );
}
