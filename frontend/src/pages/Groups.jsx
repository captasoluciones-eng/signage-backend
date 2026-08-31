import { useEffect, useState } from "react";
import { api } from "../api/client";

const EMPTY_FORM = {
  nombre: "",
  descripcion: "",
  playlistId: "",
  pollMinutes: 5,
  muteVideo: true,
  transitionMs: 500,
};

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [g, p] = await Promise.all([api.listGroups(), api.listPlaylists()]);
      setGroups(g);
      setPlaylists(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(group) {
    setEditingId(group.groupId);
    setForm({
      nombre: group.nombre,
      descripcion: group.descripcion || "",
      playlistId: group.playlistId || "",
      pollMinutes: group.settings?.pollMinutes ?? 5,
      muteVideo: group.settings?.muteVideo ?? true,
      transitionMs: group.settings?.transitionMs ?? 500,
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function submit(e) {
    e.preventDefault();
    const payload = {
      nombre: form.nombre,
      descripcion: form.descripcion,
      playlistId: form.playlistId || null,
      settings: {
        pollMinutes: Number(form.pollMinutes),
        muteVideo: Boolean(form.muteVideo),
        transitionMs: Number(form.transitionMs),
      },
    };
    if (editingId) {
      await api.updateGroup(editingId, payload);
    } else {
      await api.createGroup(payload);
    }
    resetForm();
    await load();
  }

  async function remove(groupId) {
    if (!window.confirm(`Eliminar el grupo "${groupId}"?`)) return;
    await api.deleteGroup(groupId);
    await load();
  }

  if (loading) return <div className="center-page">Cargando grupos...</div>;
  if (error) return <div className="error-banner">Error: {error}</div>;

  return (
    <div>
      <h1>Grupos</h1>

      <form className="panel form" onSubmit={submit}>
        <h2>{editingId ? `Editar grupo: ${editingId}` : "Nuevo grupo"}</h2>
        <label>
          Nombre
          <input
            className="input"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            required
          />
        </label>
        <label>
          Descripcion
          <input
            className="input"
            value={form.descripcion}
            onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
          />
        </label>
        <label>
          Playlist asignada
          <select
            className="input"
            value={form.playlistId}
            onChange={(e) => setForm({ ...form, playlistId: e.target.value })}
          >
            <option value="">(usar playlist global por defecto)</option>
            {playlists.map((p) => (
              <option key={p.playlistId} value={p.playlistId}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Poll minutes
            <input
              type="number"
              min="1"
              className="input"
              value={form.pollMinutes}
              onChange={(e) => setForm({ ...form, pollMinutes: e.target.value })}
            />
          </label>
          <label>
            Transition ms
            <input
              type="number"
              min="0"
              className="input"
              value={form.transitionMs}
              onChange={(e) => setForm({ ...form, transitionMs: e.target.value })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.muteVideo}
              onChange={(e) => setForm({ ...form, muteVideo: e.target.checked })}
            />
            Silenciar video
          </label>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit">
            {editingId ? "Guardar cambios" : "Crear grupo"}
          </button>
          {editingId && (
            <button className="btn btn-ghost" type="button" onClick={resetForm}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            <th>Grupo</th>
            <th>Nombre</th>
            <th>Playlist</th>
            <th>Poll min</th>
            <th>Mute</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.groupId}>
              <td>{g.groupId}</td>
              <td>{g.nombre}</td>
              <td>{g.playlistId || "-"}</td>
              <td>{g.settings?.pollMinutes}</td>
              <td>{g.settings?.muteVideo ? "Si" : "No"}</td>
              <td className="row-actions">
                <button className="btn btn-sm" onClick={() => startEdit(g)}>
                  Editar
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(g.groupId)}>
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
