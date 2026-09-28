import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useLiveDevices } from "../hooks/useLiveDevices";
import Modal from "../components/Modal";
import { IconRefresh } from "../components/Icons";

const PAGE_SIZE = 20;

// Los VALORES (reload/restart/...) son los que entiende la app en la pantalla y
// NO deben cambiar; solo se les da una etiqueta clara para el equipo. Las
// descripciones reflejan lo que de verdad hace cada comando: "Actualizar" solo
// fuerza a buscar cambios de playlist, mientras que "Reiniciar" recarga la app
// por completo (lo que sirve cuando una pantalla se quedó congelada o en negro).
const COMMANDS = ["reload", "restart", "clearWebCache", "blackout"];
const COMMAND_META = {
  reload: {
    label: "Actualizar contenido",
    desc: "Busca cambios de playlist de inmediato.",
  },
  restart: {
    label: "Reiniciar aplicación",
    desc: "Recarga la app por completo. Úsalo si la pantalla se ve congelada o en negro.",
  },
  clearWebCache: {
    label: "Limpiar caché",
    desc: "Borra el caché web de la pantalla.",
  },
  blackout: {
    label: "Pantalla en negro",
    desc: "Apaga temporalmente la imagen de la pantalla.",
  },
};

const ESTADO_LABEL = {
  activo: "Activo",
  pendiente: "Pendiente",
  deshabilitado: "Deshabilitado",
};

function formatLastSeen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "Hace un momento";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH} h`;
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("activo");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null); // {type, ...ctx}
  const [modalValue, setModalValue] = useState("");
  const [working, setWorking] = useState(false);
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

  const groupName = useMemo(() => {
    const map = {};
    groups.forEach((g) => (map[g.groupId] = g.nombre));
    return map;
  }, [groups]);

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

  async function disable(deviceId, disabled) {
    await api.setDisabled(deviceId, disabled);
    await load();
  }

  // ---- Modales (reemplazan window.prompt) ----
  function openReassign(deviceId, currentGroupId) {
    setModalValue(currentGroupId || "");
    setModal({ type: "reassign", deviceId });
  }
  function openOverlay(deviceId, currentText) {
    setModalValue(currentText || "");
    setModal({ type: "overlay", deviceId });
  }
  function openBulkConfirm(command) {
    setModal({ type: "bulkConfirm", command });
  }
  function closeModal() {
    if (working) return;
    setModal(null);
    setModalValue("");
  }

  async function confirmModal() {
    if (!modal) return;
    setWorking(true);
    try {
      if (modal.type === "reassign") {
        if (!modalValue) return;
        await api.reassignGroup(modal.deviceId, modalValue);
        await load();
      } else if (modal.type === "overlay") {
        await api.setOverlay(modal.deviceId, { text: modalValue, enabled: modalValue.length > 0 });
        await load();
      } else if (modal.type === "bulkConfirm") {
        await runBulkCommand(modal.command);
      }
      setModal(null);
      setModalValue("");
    } catch (e) {
      setError(e.message);
      setModal(null);
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className="center-page">Cargando pantallas…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Pantallas</h1>
          <div className="page-sub">
            Administra las TVs, revisa cuáles están en línea y envíales comandos.
          </div>
        </div>
        <button className="btn" onClick={load}>
          <IconRefresh width={16} height={16} />
          Refrescar
        </button>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}

      <div className="toolbar">
        <input
          className="input search-input"
          placeholder="Buscar por nombre, ID o versión…"
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
      </div>

      {selected.size > 0 && (
        <div className="selection-bar">
          <span className="selection-count">{selected.size} pantalla(s) seleccionada(s)</span>
          <span className="hint">Enviar a todas:</span>
          {COMMANDS.map((cmd) => (
            <button
              key={cmd}
              className="btn btn-sm"
              title={COMMAND_META[cmd].desc}
              onClick={() => openBulkConfirm(cmd)}
            >
              {COMMAND_META[cmd].label}
            </button>
          ))}
          <div className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Limpiar selección
          </button>
        </div>
      )}

      {groupFilter && selected.size === 0 && (
        <div className="selection-bar">
          <span className="selection-count">Grupo: {groupName[groupFilter] || groupFilter}</span>
          <span className="hint">Aplicar a todo el grupo:</span>
          {COMMANDS.map((cmd) => (
            <button
              key={`g-${cmd}`}
              className="btn btn-sm btn-ghost"
              title={COMMAND_META[cmd].desc}
              onClick={() => runGroupCommand(cmd)}
            >
              {COMMAND_META[cmd].label}
            </button>
          ))}
        </div>
      )}

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={pageItems.length > 0 && pageItems.every((d) => selected.has(d.deviceId))}
                    onChange={toggleSelectAllOnPage}
                    aria-label="Seleccionar todas"
                  />
                </th>
                <th>Pantalla</th>
                <th>Conexión</th>
                <th>Grupo</th>
                <th>Estado</th>
                <th>Reproduciendo</th>
                <th>Última vez vista</th>
                <th>Versión</th>
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
                      aria-label={`Seleccionar ${d.nombre || d.deviceId}`}
                    />
                  </td>
                  <td>
                    <div className="cell-strong">{d.nombre || d.deviceId}</div>
                    {d.nombre && <div className="cell-muted" style={{ fontSize: "0.76rem" }}>{d.deviceId}</div>}
                  </td>
                  <td>
                    <span className={"status-pill " + (d.online ? "is-online" : "is-offline")}>
                      <span className="dot" />
                      {d.online ? "En línea" : "Desconectada"}
                    </span>
                  </td>
                  <td>{d.groupId ? groupName[d.groupId] || d.groupId : <span className="cell-muted">Sin grupo</span>}</td>
                  <td>
                    <span className={"badge badge-" + d.estado}>{ESTADO_LABEL[d.estado] || d.estado}</span>
                  </td>
                  <td className="cell-muted">{d.itemActual || "—"}</td>
                  <td className="cell-muted">{formatLastSeen(d.lastSeen)}</td>
                  <td className="cell-muted">{d.appVersion || "—"}</td>
                  <td className="row-actions">
                    <select
                      className="input input-sm"
                      style={{ width: "auto" }}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) runCommand(d.deviceId, e.target.value);
                        e.target.value = "";
                      }}
                    >
                      <option value="" disabled>
                        Enviar comando…
                      </option>
                      {COMMANDS.map((cmd) => (
                        <option key={cmd} value={cmd} title={COMMAND_META[cmd].desc}>
                          {COMMAND_META[cmd].label}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-sm" onClick={() => openOverlay(d.deviceId, d.overlayText)}>
                      Mensaje
                    </button>
                    <button className="btn btn-sm" onClick={() => openReassign(d.deviceId, d.groupId)}>
                      Cambiar grupo
                    </button>
                    <button
                      className={"btn btn-sm " + (d.estado === "deshabilitado" ? "" : "btn-danger")}
                      onClick={() => disable(d.deviceId, d.estado !== "deshabilitado")}
                    >
                      {d.estado === "deshabilitado" ? "Habilitar" : "Deshabilitar"}
                    </button>
                  </td>
                </tr>
              ))}
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state">
                      No hay pantallas que coincidan con los filtros.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pagination">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </button>
        <span>
          Página {page} de {totalPages} · {filtered.length} pantalla(s)
        </span>
        <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Siguiente
        </button>
      </div>

      {modal?.type === "reassign" && (
        <Modal
          title="Cambiar de grupo"
          description="Elige el grupo al que pertenecerá esta pantalla."
          onClose={closeModal}
          actions={
            <>
              <button className="btn btn-ghost" onClick={closeModal} disabled={working}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={confirmModal} disabled={working || !modalValue}>
                {working ? "Guardando…" : "Guardar"}
              </button>
            </>
          }
        >
          <span className="modal-field-label">Grupo</span>
          <select className="input" value={modalValue} onChange={(e) => setModalValue(e.target.value)}>
            <option value="" disabled>
              Selecciona un grupo…
            </option>
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.nombre}
              </option>
            ))}
          </select>
        </Modal>
      )}

      {modal?.type === "overlay" && (
        <Modal
          title="Mensaje en pantalla"
          description="Muestra un texto sobrepuesto en la pantalla. Déjalo vacío para quitarlo."
          onClose={closeModal}
          actions={
            <>
              <button className="btn btn-ghost" onClick={closeModal} disabled={working}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={confirmModal} disabled={working}>
                {working ? "Enviando…" : modalValue.length > 0 ? "Mostrar mensaje" : "Quitar mensaje"}
              </button>
            </>
          }
        >
          <span className="modal-field-label">Texto</span>
          <textarea
            className="input"
            placeholder="Ej. Sucursal en mantenimiento…"
            value={modalValue}
            onChange={(e) => setModalValue(e.target.value)}
            autoFocus
          />
        </Modal>
      )}

      {modal?.type === "bulkConfirm" && (
        <Modal
          title="Confirmar comando"
          description={COMMAND_META[modal.command].desc}
          onClose={closeModal}
          actions={
            <>
              <button className="btn btn-ghost" onClick={closeModal} disabled={working}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={confirmModal} disabled={working}>
                {working ? "Enviando…" : `Enviar a ${selected.size} pantalla(s)`}
              </button>
            </>
          }
        >
          <p className="hint">
            Se enviará <strong>{COMMAND_META[modal.command].label}</strong> a {selected.size} pantalla(s)
            seleccionada(s).
          </p>
        </Modal>
      )}
    </div>
  );
}
