import { useEffect, useState } from "react";
import { api } from "../api/client";

function newItem() {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "imagen",
    url: "",
    durationSec: 10,
    scale: "fill",
    orden: 0,
    activo: true,
    vigenciaDesde: "",
    vigenciaHasta: "",
  };
}

export default function Playlists() {
  const [playlists, setPlaylists] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [nombre, setNombre] = useState("");
  const [items, setItems] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load(selectAfter) {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listPlaylists();
      setPlaylists(list);
      const defaultSelection = selectAfter || (list[0] && list[0].playlistId) || null;
      if (defaultSelection) await selectPlaylist(defaultSelection, list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function selectPlaylist(playlistId, listOverride) {
    const list = listOverride || playlists;
    const found = list.find((p) => p.playlistId === playlistId);
    if (!found) return;
    setSelectedId(playlistId);
    setNombre(found.nombre);
    setItems((found.items || []).slice().sort((a, b) => a.orden - b.orden));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function createNew() {
    setSelectedId(null);
    setNombre("Nueva playlist");
    setItems([]);
  }

  function updateItem(index, patch) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems((prev) => [...prev, { ...newItem(), orden: prev.length + 1 }]);
  }

  function onDragStart(index) {
    setDragIndex(index);
  }

  function onDragOver(e, index) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setDragIndex(index);
  }

  function onDragEnd() {
    setDragIndex(null);
    // Re-number `orden` to match the visual order.
    setItems((prev) => prev.map((it, i) => ({ ...it, orden: i + 1 })));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const normalized = items.map((it, i) => ({
        ...it,
        orden: i + 1,
        durationSec: it.durationSec ? Number(it.durationSec) : null,
        vigenciaDesde: it.vigenciaDesde || null,
        vigenciaHasta: it.vigenciaHasta || null,
      }));
      if (selectedId) {
        await api.updatePlaylist(selectedId, { nombre, items: normalized });
        await load(selectedId);
      } else {
        const created = await api.createPlaylist({ nombre, items: normalized });
        await load(created.playlistId);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(playlistId) {
    if (!window.confirm(`Eliminar la playlist "${playlistId}"?`)) return;
    await api.deletePlaylist(playlistId);
    createNew();
    await load();
  }

  if (loading) return <div className="center-page">Cargando playlists...</div>;

  return (
    <div>
      <h1>Playlists</h1>
      {error && <div className="error-banner">Error: {error}</div>}

      <div className="toolbar">
        <select
          className="input"
          value={selectedId || ""}
          onChange={(e) => selectPlaylist(e.target.value)}
        >
          {playlists.map((p) => (
            <option key={p.playlistId} value={p.playlistId}>
              {p.nombre} ({p.playlistId})
            </option>
          ))}
        </select>
        <button className="btn" onClick={createNew}>
          Nueva playlist
        </button>
        {selectedId && (
          <button className="btn btn-danger" onClick={() => remove(selectedId)}>
            Eliminar esta playlist
          </button>
        )}
      </div>

      <div className="panel">
        <label>
          Nombre de la playlist
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
      </div>

      <div className="panel">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Items ({items.length})</h2>
          <button className="btn btn-sm" onClick={addItem}>
            + Agregar item
          </button>
        </div>

        <p className="hint">Arrastra las filas por la columna izquierda para reordenar.</p>

        <table className="data-table playlist-editor">
          <thead>
            <tr>
              <th></th>
              <th>Orden</th>
              <th>Tipo</th>
              <th>URL</th>
              <th>Preview</th>
              <th>Duracion (s)</th>
              <th>Escala</th>
              <th>Vigente desde</th>
              <th>Vigente hasta</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, index) => (
              <tr
                key={it.id}
                draggable
                onDragStart={() => onDragStart(index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDragEnd={onDragEnd}
                className={dragIndex === index ? "dragging" : ""}
              >
                <td className="drag-handle" title="Arrastrar para reordenar">
                  ::
                </td>
                <td>{index + 1}</td>
                <td>
                  <select
                    className="input input-sm"
                    value={it.type}
                    onChange={(e) => updateItem(index, { type: e.target.value })}
                  >
                    <option value="video">video</option>
                    <option value="imagen">imagen</option>
                    <option value="link">link</option>
                  </select>
                </td>
                <td>
                  <input
                    className="input input-sm"
                    value={it.url}
                    onChange={(e) => updateItem(index, { url: e.target.value })}
                    placeholder="https://..."
                  />
                </td>
                <td>
                  <ItemPreview item={it} />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    className="input input-sm"
                    value={it.durationSec ?? ""}
                    onChange={(e) => updateItem(index, { durationSec: e.target.value })}
                    disabled={it.type === "video"}
                    title={it.type === "video" ? "Los videos usan su propia duracion" : ""}
                  />
                </td>
                <td>
                  <select
                    className="input input-sm"
                    value={it.scale || "fill"}
                    onChange={(e) => updateItem(index, { scale: e.target.value })}
                  >
                    <option value="fill">fill</option>
                    <option value="fit">fit</option>
                    <option value="cover">cover</option>
                  </select>
                </td>
                <td>
                  <input
                    type="date"
                    className="input input-sm"
                    value={it.vigenciaDesde || ""}
                    onChange={(e) => updateItem(index, { vigenciaDesde: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="date"
                    className="input input-sm"
                    value={it.vigenciaHasta || ""}
                    onChange={(e) => updateItem(index, { vigenciaHasta: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={it.activo}
                    onChange={(e) => updateItem(index, { activo: e.target.checked })}
                  />
                </td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem(index)}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Guardando..." : "Guardar playlist"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemPreview({ item }) {
  if (!item.url) return <span className="hint">sin URL</span>;
  if (item.type === "imagen") {
    return <img src={item.url} alt="" className="thumb-preview" />;
  }
  if (item.type === "video") {
    return <video src={item.url} className="thumb-preview" muted />;
  }
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className="truncate">
      {item.url}
    </a>
  );
}
