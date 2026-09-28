import { useEffect, useState } from "react";
import { api } from "../api/client";
import { downloadCsv } from "../utils/csv";
import { IconRefresh } from "../components/Icons";

const TABS = [
  { key: "uptime", label: "Uptime por dispositivo" },
  { key: "availability", label: "Disponibilidad por grupo" },
  { key: "errors", label: "Errores" },
  { key: "proofOfPlay", label: "Proof of play" },
];

// Etiquetas legibles para las columnas (las claves vienen crudas de la API).
const COLUMN_LABELS = {
  fecha: "Fecha",
  ts: "Fecha y hora",
  deviceId: "Dispositivo",
  nombre: "Nombre",
  groupId: "Grupo",
  uptimePct: "Uptime",
  dispositivosTotal: "Dispositivos",
  dispositivosOnline: "En línea",
  disponibilidadPct: "Disponibilidad",
  itemId: "Item",
  url: "URL",
  tipo: "Tipo",
  errores: "Errores",
  durationSec: "Duración (s)",
  resultado: "Resultado",
};

// Campos largos que conviene recortar para no romper el ancho de la tabla.
const LONG_FIELDS = new Set(["deviceId", "itemId", "url"]);

function formatCell(col, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (col.endsWith("Pct")) return `${Number(value).toFixed(1)}%`;
  return String(value);
}

export default function Reports() {
  const [tab, setTab] = useState(TABS[0].key);
  const [days, setDays] = useState(7);
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      let data;
      if (tab === "uptime") data = await api.reportUptime({ days });
      else if (tab === "availability") data = await api.reportAvailabilityByGroup({ days });
      else if (tab === "errors") data = await api.reportErrors({ hours });
      else data = await api.reportProofOfPlay({ days });
      setRows(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, days, hours]);

  function exportCsv() {
    downloadCsv(`signage-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reportes</h1>
          <div className="page-sub">Uptime, disponibilidad, errores y reproducción de las pantallas.</div>
        </div>
      </div>

      <div className="toolbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"btn btn-sm" + (tab === t.key ? " btn-primary" : " btn-ghost")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        {tab !== "errors" ? (
          <label className="inline-field">
            <span className="toolbar-label">Días</span>
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={7}>7</option>
              <option value={30}>30</option>
              <option value={90}>90</option>
            </select>
          </label>
        ) : (
          <label className="inline-field">
            <span className="toolbar-label">Ventana</span>
            <select className="input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              <option value={24}>24 horas</option>
              <option value={168}>7 días</option>
            </select>
          </label>
        )}
        <button className="btn" onClick={load}>
          <IconRefresh width={16} height={16} />
          Refrescar
        </button>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={exportCsv} disabled={rows.length === 0}>
          Exportar CSV
        </button>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}

      {loading ? (
        <div className="center-page">Cargando reporte…</div>
      ) : rows.length === 0 ? (
        <div className="table-wrap">
          <div className="empty-state">Sin datos para este rango.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{COLUMN_LABELS[c] || c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c} className={LONG_FIELDS.has(c) ? "cell-muted" : ""}>
                        {LONG_FIELDS.has(c) ? (
                          <span className="truncate" title={String(row[c] ?? "")}>
                            {formatCell(c, row[c])}
                          </span>
                        ) : (
                          formatCell(c, row[c])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
