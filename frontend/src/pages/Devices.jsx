import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useLiveDevices } from "../hooks/useLiveDevices";

const PAGE_SIZE = 20;
const COMMANDS = ["reload", "restart", "clearWebCache", "blackout"];

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState(""); // default: all groups
  const [estadoFilter, setEstadoFilter] = useState("activo"); // sensible default selection
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const { liveById } = useLiveDevices();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [deviceList, groupList] = await Promise.all([
        api.listDevices({ limit: 1000 }),
        api.listGroups(),
      ]);
      setDevices(deviceList);
      setGroups(groupList);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const merged = useMemo(
    () => devices.map((d) => ({ ...d, ...(liveById[d.deviceId] || {}) })),
    [devices, liveById]
  );

  const filtered = useMemo(() => {
    return merged.filter((d) => {
      if (groupFilter && d.groupId !== groupFilter) return false;
      if (estadoFilter && d.estado !== estadoFilter) return false;
      if (search) {
        const haystack = `${d.nombre || ""} ${d.deviceId} ${d.appVersion || ""}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [merged, groupFilter, estadoFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSelected(deviceId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = pageItems.every((d) => next.has(d.deviceId));
      pageItems.forEach((d) => (allSelected ? next.delete(d.deviceId) : next.add(d.deviceId)));
      return next;
    });
  }

  async function runCommand(deviceId, command) {
    await api.sendCommand(deviceId, command);
    await load();
  }

  async function runBulkCommand(command) {
    if (selected.size === 0) return;
    await api.bulkCommand({ command, deviceIds: Array.from(selected) });
    setSelected(new Set());
    await load();
  }

  async function runGroupCommand(command) {
    if (!groupFilter) return;
    await api.bulkCommand({ command, groupId: groupFilter });
    await load();
  }

  async function reassign(deviceId) {
    const groupId = window.prompt("Nuevo groupId:");
    if (!groupId) return;
    await api.reassignGroup(deviceId, groupId);
    await load();
  }

  async function disable(deviceId, disabled) {
    await api.setDisabled(deviceId, disabled);
    await load();
  }

  async function sendOverlay(deviceId) {
    const text = window.prompt("Texto del overlay (vacio para limpiar):", "");
    if (text === null) return;
    await api.setOverlay(deviceId, { text, enabled: text.length > 0 });
    await load();
  }

  if (loading) return <div className="center-page">Cargando dispositivos...</div>;
  if (error) return <div className="error-banner">Error: {error}</div>;

  return (
    <div>
      <h1>Dispositivos</h1>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Buscar por nombre, id o version..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="input"
          value={groupFilter}
          onChange={(e) => {
            setGroupFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los grupos</option>
          {groups.map((g) => (
            <option key={g.groupId} value={g.groupId}>
              {g.nombre}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={estadoFilter}
          onChange={(e) => {
            setEstadoFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activo</option>
          <option value="pendiente">Pendiente</option>
          <option value="deshabilitado">Deshabilitado</option>
        </select>
        <button className="btn" onClick={load}>
          Refrescar
        </button>
      </div>

      <div className="toolbar">
        <span className="hint">{selected.size} seleccionados</span>
        {COMMANDS.map((cmd) => (
          <button key={cmd} className="btn btn-sm" onClick={() => runBulkCommand(cmd)} disabled={selected.size === 0}>
            {cmd} (seleccion)
          </button>
        ))}
        {groupFilter && (
          <>
            {COMMANDS.map((cmd) => (
              <button key={`g-${cmd}`} className="btn btn-sm btn-ghost" onClick={() => runGroupCommand(cmd)}>
                {cmd} (grupo)
              </button>
            ))}
          </>
        )}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={pageItems.length > 0 && pageItems.every((d) => selected.has(d.deviceId))}
                onChange={toggleSelectAllOnPage}
              />
            </th>
            <th>Nombre</th>
            <th>Grupo</th>
            <th>Estado</th>
            <th>Item actual</th>
            <th>Ultima vez visto</th>
            <th>Version app</th>
            <th>Resolucion</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((d) => (
            <tr key={d.deviceId}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(d.deviceId)}
                  onChange={() => toggleSelected(d.deviceId)}
                />
              </td>
              <td>{d.nombre || <em>{d.deviceId}</em>}</td>
              <td>{d.groupId || "-"}</td>
              <td>
                <span className={"badge badge-" + d.estado}>{d.estado}</span>
              </td>
              <td>{d.itemActual || "-"}</td>
              <td>{d.lastSeen || "-"}</td>
              <td>{d.appVersion || "-"}</td>
              <td>{d.resolucion || "-"}</td>
              <td className="row-actions">
                <select
                  className="input input-sm"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) runCommand(d.deviceId, e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="" disabled>
                    Comando...
                  </option>
                  {COMMANDS.map((cmd) => (
                    <option key={cmd} value={cmd}>
                      {cmd}
                    </option>
                  ))}
                </select>
                <button className="btn btn-sm" onClick={() => sendOverlay(d.deviceId)}>
                  Overlay
                </button>
                <button className="btn btn-sm" onClick={() => reassign(d.deviceId)}>
                  Reasignar grupo
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => disable(d.deviceId, d.estado !== "deshabilitado")}
                >
                  {d.estado === "deshabilitado" ? "Habilitar" : "Deshabilitar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pagination">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </button>
        <span>
          Pagina {page} de {totalPages} ({filtered.length} dispositivos)
        </span>
        <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Siguiente
        </button>
      </div>
    </div>
  );
}
