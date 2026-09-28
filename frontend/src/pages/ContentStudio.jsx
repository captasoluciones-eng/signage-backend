import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import {
  loadImageFromFile,
  renderPhotoSlide,
  renderCollageSlide,
  renderAnnouncementSlide,
  renderFlashySlide,
  FLASHY_PALETTES,
  canvasToJpegBlob,
} from "../utils/slideComposer";

const MODES = [
  {
    id: "foto",
    emoji: "🖼️",
    title: "Una foto con texto",
    desc: "Una foto grande (viaje, evento, equipo) con un título abajo.",
  },
  {
    id: "collage",
    emoji: "🧩",
    title: "Dos fotos juntas",
    desc: "Dos fotos del mismo evento, una junto a la otra, con un título arriba.",
  },
  {
    id: "aviso",
    emoji: "📢",
    title: "Aviso o invitación",
    desc: "Una imagen que ya trae su texto (una tarjeta, un comunicado, una invitación).",
  },
  {
    id: "llamativo",
    emoji: "✨",
    title: "Aviso llamativo",
    desc: "Tu foto con un fondo de rayos de color, para que la pantalla llame la atención.",
  },
  {
    id: "convivencia",
    emoji: "🎉",
    title: "Convivencia / Anuncio RH",
    desc: "Título, fecha, lugar y foto — el tablero arma la pantalla animada solo, sin diseñar nada.",
  },
];

function emptyPlaylistState() {
  return { playlistId: null, nombre: null, items: [] };
}

export default function ContentStudio() {
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [playlist, setPlaylist] = useState(emptyPlaylistState());
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);

  const [mode, setMode] = useState("foto");
  const [img1, setImg1] = useState(null);
  const [img2, setImg2] = useState(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [headline, setHeadline] = useState("");
  const [durationSec, setDurationSec] = useState(8);

  // "Convivencia / Anuncio RH" mode: fields that fill the tablero's animated
  // RH template directly (no canvas rasterization -- see publish()).
  const [fecha, setFecha] = useState("");
  const [lugar, setLugar] = useState("");
  const [rhPhotoFile, setRhPhotoFile] = useState(null);
  const [rhAnnouncement, setRhAnnouncement] = useState(null);
  const [loadingRhAnnouncement, setLoadingRhAnnouncement] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const canvasRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listGroups();
        setGroups(list);
        if (list.length) setGroupId(list[0].groupId);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoadingGroups(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!groupId) return;
    loadPlaylistForGroup(groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, groups]);

  useEffect(() => {
    if (!groupId) return;
    setLoadingRhAnnouncement(true);
    api
      .getRHAnnouncement(groupId)
      .then((ann) => setRhAnnouncement(ann))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingRhAnnouncement(false));
  }, [groupId]);

  async function loadPlaylistForGroup(gid) {
    const group = groups.find((g) => g.groupId === gid);
    if (!group) return;
    if (!group.playlistId) {
      setPlaylist(emptyPlaylistState());
      return;
    }
    setLoadingPlaylist(true);
    try {
      const pl = await api.getPlaylist(group.playlistId);
      setPlaylist({ playlistId: pl.playlistId, nombre: pl.nombre, items: pl.items || [] });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingPlaylist(false);
    }
  }

  // Re-draw the live preview whenever anything relevant changes. "convivencia"
  // has its own HTML preview card below (see JSX) instead of a canvas, since
  // its content is never rasterized -- skip this effect entirely for it.
  useEffect(() => {
    if (mode === "convivencia") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (mode === "foto" && img1) {
      renderPhotoSlide(canvas, img1, title, subtitle);
    } else if (mode === "collage" && (img1 || img2)) {
      renderCollageSlide(canvas, img1, img2, title, subtitle);
    } else if (mode === "aviso" && img1) {
      renderAnnouncementSlide(canvas, img1, headline);
    } else if (mode === "llamativo" && img1) {
      // Cycle the palette by how many items are already on this screen, so
      // consecutive "Aviso llamativo" posts don't all land on the same colors.
      renderFlashySlide(canvas, img1, headline, playlist.items.length);
    } else {
      const ctx = canvas.getContext("2d");
      canvas.width = 1920;
      canvas.height = 1080;
      ctx.fillStyle = "#0e2e1a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [mode, img1, img2, title, subtitle, headline, playlist.items.length]);

  async function onPickImage(e, which) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = await loadImageFromFile(file);
    if (which === 1) setImg1(img);
    else setImg2(img);
  }

  function onPickRhPhoto(e) {
    const file = e.target.files?.[0];
    if (file) setRhPhotoFile(file);
  }

  function prefillRhForm(ann) {
    setTitle(ann?.titulo || "");
    setFecha(ann?.fecha || "");
    setLugar(ann?.lugar || "");
  }

  function resetForm() {
    setImg1(null);
    setImg2(null);
    setTitle("");
    setSubtitle("");
    setHeadline("");
    setFecha("");
    setLugar("");
    setRhPhotoFile(null);
  }

  function canPublish() {
    if (!groupId) return false;
    if (mode === "foto") return !!img1 && title.trim().length > 0;
    if (mode === "collage") return !!(img1 || img2) && title.trim().length > 0;
    if (mode === "aviso") return !!img1 && headline.trim().length > 0;
    if (mode === "llamativo") return !!img1 && headline.trim().length > 0;
    if (mode === "convivencia")
      return title.trim().length > 0 && fecha.trim().length > 0 && lugar.trim().length > 0;
    return false;
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === "convivencia") {
        let fotoUrl = rhAnnouncement?.fotoUrl || null;
        if (rhPhotoFile) {
          const filename = `rh-anuncio-${Date.now()}.jpg`;
          const { uploadUrl, gcsPath, cdnUrl } = await api.getSignedUploadUrl(
            filename,
            "image/jpeg"
          );
          await api.uploadToSignedUrl(uploadUrl, rhPhotoFile, "image/jpeg");
          await api.createAsset({
            nombre: filename,
            tipo: "imagen",
            gcsPath,
            cdnUrl,
            bytes: rhPhotoFile.size,
          });
          fotoUrl = cdnUrl;
        }
        const saved = await api.upsertRHAnnouncement(groupId, {
          titulo: title.trim(),
          fecha: fecha.trim(),
          lugar: lugar.trim(),
          fotoUrl,
          ctaTexto: "¡LOS ESPERAMOS!",
          activo: true,
        });
        setRhAnnouncement(saved);
        setSuccess("Publicado. La pantalla de RH del tablero se actualiza sola, sin subir ninguna imagen diseñada a mano.");
        resetForm();
        return;
      }

      const canvas = canvasRef.current;
      const blob = await canvasToJpegBlob(canvas, 0.9);
      const filename = `rh-${Date.now()}.jpg`;
      const { uploadUrl, gcsPath, cdnUrl } = await api.getSignedUploadUrl(filename, "image/jpeg");
      await api.uploadToSignedUrl(uploadUrl, blob, "image/jpeg");
      const asset = await api.createAsset({
        nombre: filename,
        tipo: "imagen",
        gcsPath,
        cdnUrl,
        bytes: blob.size,
      });

      const group = groups.find((g) => g.groupId === groupId);
      const newItem = {
        id: `item-${Date.now()}`,
        type: "imagen",
        url: asset.cdnUrl,
        durationSec: Number(durationSec) || 8,
        scale: "fill",
        orden: playlist.items.length + 1,
        activo: true,
      };

      let targetPlaylistId = playlist.playlistId;
      if (targetPlaylistId) {
        const nextItems = [...playlist.items, newItem];
        await api.updatePlaylist(targetPlaylistId, { items: nextItems });
        setPlaylist((p) => ({ ...p, items: nextItems }));
      } else {
        const created = await api.createPlaylist({
          nombre: `${group?.nombre || groupId} - Contenido`,
          items: [newItem],
        });
        await api.updateGroup(groupId, { playlistId: created.playlistId });
        setGroups((gs) => gs.map((g) => (g.groupId === groupId ? { ...g, playlistId: created.playlistId } : g)));
        setPlaylist({ playlistId: created.playlistId, nombre: created.nombre, items: created.items });
      }

      setSuccess("Publicado. En unos minutos aparece en la pantalla.");
      resetForm();
    } catch (e) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  async function removeRhAnnouncement() {
    if (!groupId) return;
    if (!window.confirm("¿Quitar el anuncio de RH de esta pantalla?")) return;
    try {
      await api.deleteRHAnnouncement(groupId);
      setRhAnnouncement(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeItem(itemId) {
    if (!playlist.playlistId) return;
    if (!window.confirm("¿Quitar este contenido de la pantalla?")) return;
    const nextItems = playlist.items
      .filter((it) => it.id !== itemId)
      .map((it, i) => ({ ...it, orden: i + 1 }));
    try {
      await api.updatePlaylist(playlist.playlistId, { items: nextItems });
      setPlaylist((p) => ({ ...p, items: nextItems }));
    } catch (e) {
      setError(e.message);
    }
  }

  if (loadingGroups) return <div className="center-page">Cargando...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Crear contenido</h1>
          <p className="page-sub">
            Sube una foto o un aviso, escribe el texto, y publícalo directo en la pantalla. Sin
            tocar URLs ni playlists a mano.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}
      {success && <div className="panel success-panel">{success}</div>}

      <div className="studio-grid">
        <div className="panel studio-form">
          <label className="studio-field">
            <span className="modal-field-label">¿Para qué pantalla es?</span>
            <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.nombre}
                </option>
              ))}
            </select>
          </label>

          <div className="studio-field">
            <span className="modal-field-label">¿Qué tipo de contenido?</span>
            <div className="studio-mode-grid">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={"studio-mode-card" + (mode === m.id ? " active" : "")}
                  onClick={() => {
                    setMode(m.id);
                    resetForm();
                    if (m.id === "convivencia") prefillRhForm(rhAnnouncement);
                  }}
                >
                  <span className="studio-mode-emoji">{m.emoji}</span>
                  <span className="studio-mode-title">{m.title}</span>
                  <span className="studio-mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {mode === "foto" && (
            <>
              <label className="studio-field">
                <span className="modal-field-label">Foto</span>
                <input type="file" accept="image/*" className="input" onChange={(e) => onPickImage(e, 1)} />
              </label>
              <p className="hint">
                Foto horizontal (apaisada), idealmente 1600×900 o mayor. Una foto vertical se ve completa
                pero más chica, con fondo difuminado alrededor.
              </p>
              <label className="studio-field">
                <span className="modal-field-label">Título</span>
                <input
                  className="input"
                  placeholder="Ej. Viaje Anual de Aliadas"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="studio-field">
                <span className="modal-field-label">Subtítulo (opcional)</span>
                <input
                  className="input"
                  placeholder="Ej. Río de Janeiro, Brasil"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                />
              </label>
            </>
          )}

          {mode === "collage" && (
            <>
              <label className="studio-field">
                <span className="modal-field-label">Foto 1</span>
                <input type="file" accept="image/*" className="input" onChange={(e) => onPickImage(e, 1)} />
              </label>
              <label className="studio-field">
                <span className="modal-field-label">Foto 2</span>
                <input type="file" accept="image/*" className="input" onChange={(e) => onPickImage(e, 2)} />
              </label>
              <p className="hint">
                Dos fotos horizontales (apaisadas), de proporciones parecidas entre sí, se ven mejor
                una junto a la otra.
              </p>
              <label className="studio-field">
                <span className="modal-field-label">Título</span>
                <input
                  className="input"
                  placeholder="Ej. Viaje Anual de Aliadas"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="studio-field">
                <span className="modal-field-label">Subtítulo (opcional)</span>
                <input
                  className="input"
                  placeholder="Ej. Corcovado y Pan de Azúcar"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                />
              </label>
            </>
          )}

          {mode === "aviso" && (
            <>
              <label className="studio-field">
                <span className="modal-field-label">Imagen del aviso</span>
                <input type="file" accept="image/*" className="input" onChange={(e) => onPickImage(e, 1)} />
              </label>
              <p className="hint">
                Esta imagen debe traer su propio texto ya diseñado (una tarjeta, invitación o flyer).
                Funciona mejor vertical, tipo carta o póster — se muestra completa, sin recortes.
              </p>
              <label className="studio-field">
                <span className="modal-field-label">Encabezado llamativo</span>
                <input
                  className="input"
                  placeholder="Ej. ¡No te lo pierdas!"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                />
              </label>
            </>
          )}

          {mode === "llamativo" && (
            <>
              <label className="studio-field">
                <span className="modal-field-label">Foto</span>
                <input type="file" accept="image/*" className="input" onChange={(e) => onPickImage(e, 1)} />
              </label>
              <p className="hint">
                Foto horizontal (apaisada): se recorta para llenar una tarjeta ancha, así que evita fotos
                verticales o con gente muy cerca de las orillas.
              </p>
              <label className="studio-field">
                <span className="modal-field-label">Encabezado llamativo</span>
                <input
                  className="input"
                  placeholder="Ej. ¡No te lo pierdas!"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                />
              </label>
              <p className="hint">
                El color de fondo cambia solo en cada publicación, para que no se repita siempre el
                mismo.
              </p>
            </>
          )}

          {mode === "convivencia" && (
            <>
              <label className="studio-field">
                <span className="modal-field-label">Título</span>
                <input
                  className="input"
                  placeholder="Ej. ¡Te invitamos a nuestra convivencia mensual!"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="studio-field">
                <span className="modal-field-label">Fecha y hora</span>
                <input
                  className="input"
                  placeholder="Ej. Viernes 2 de octubre · 2:00 p.m."
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </label>
              <label className="studio-field">
                <span className="modal-field-label">Lugar</span>
                <input
                  className="input"
                  placeholder="Ej. Corporativo Capta Vale"
                  value={lugar}
                  onChange={(e) => setLugar(e.target.value)}
                />
              </label>
              <label className="studio-field">
                <span className="modal-field-label">Foto (opcional)</span>
                <input type="file" accept="image/*" className="input" onChange={onPickRhPhoto} />
              </label>
              <p className="hint">
                El tablero arma la pantalla animada solo con estos datos — no se sube ninguna imagen
                diseñada a mano. Se queda fija hasta que la reemplaces o la quites.
              </p>
            </>
          )}

          {mode !== "convivencia" && (
            <label className="studio-field studio-duration">
              <span className="modal-field-label">Segundos en pantalla</span>
              <input
                type="number"
                min="3"
                max="60"
                className="input"
                value={durationSec}
                onChange={(e) => setDurationSec(e.target.value)}
              />
            </label>
          )}

          <button className="btn btn-primary studio-publish" onClick={publish} disabled={!canPublish() || publishing}>
            {publishing ? "Publicando..." : "Publicar en esta pantalla"}
          </button>
        </div>

        <div className="studio-preview-col">
          <div className="panel studio-preview-panel">
            <h2>Vista previa</h2>
            {mode === "convivencia" ? (
              <>
                <div className="studio-rh-preview">
                  <div className="studio-rh-photo">
                    {rhPhotoFile ? (
                      <img src={URL.createObjectURL(rhPhotoFile)} alt="" />
                    ) : rhAnnouncement?.fotoUrl ? (
                      <img src={rhAnnouncement.fotoUrl} alt="" />
                    ) : (
                      <span className="asset-thumb-placeholder">Foto</span>
                    )}
                  </div>
                  <div className="studio-rh-title">{title || "Título del anuncio"}</div>
                  <div className="studio-rh-chip">
                    <span className="studio-rh-chip-label">FECHA</span>
                    <span>{fecha || "—"}</span>
                  </div>
                  <div className="studio-rh-chip">
                    <span className="studio-rh-chip-label">LUGAR</span>
                    <span>{lugar || "—"}</span>
                  </div>
                  <div className="studio-rh-cta">¡LOS ESPERAMOS!</div>
                </div>
                <p className="hint">
                  Este es solo un preview del contenido — la animación completa (el bot, el letrero
                  en movimiento, el efecto de entrada) se ve directo en el tablero.
                </p>
              </>
            ) : (
              <div className="studio-preview-frame">
                <canvas ref={canvasRef} className="studio-canvas" />
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Anuncio de RH en el tablero {loadingRhAnnouncement ? "..." : ""}</h2>
            {!loadingRhAnnouncement && !rhAnnouncement && (
              <p className="hint">Todavía no hay ningún anuncio de RH publicado en esta pantalla.</p>
            )}
            {rhAnnouncement && (
              <div className="studio-current-grid">
                <div className="studio-current-card">
                  {rhAnnouncement.fotoUrl ? (
                    <img src={rhAnnouncement.fotoUrl} alt="" />
                  ) : (
                    <div className="asset-thumb-placeholder">Sin foto</div>
                  )}
                  <div className="studio-current-meta">
                    <span className="hint">
                      {rhAnnouncement.titulo} · {rhAnnouncement.fecha}
                    </span>
                    <button className="btn btn-sm btn-danger" onClick={removeRhAnnouncement}>
                      Quitar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Contenido actual en esta pantalla {loadingPlaylist ? "..." : `(${playlist.items.length})`}</h2>
            {playlist.items.length === 0 && !loadingPlaylist && (
              <p className="hint">Todavía no hay nada publicado en esta pantalla.</p>
            )}
            <div className="studio-current-grid">
              {playlist.items.map((it) => (
                <div key={it.id} className="studio-current-card">
                  {it.type === "imagen" ? (
                    <img src={it.url} alt="" />
                  ) : (
                    <div className="asset-thumb-placeholder">{it.type}</div>
                  )}
                  <div className="studio-current-meta">
                    <span className="hint">{it.durationSec}s</span>
                    <button className="btn btn-sm btn-danger" onClick={() => removeItem(it.id)}>
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
