import { useEffect, useState } from "react";
import { api } from "../api/client";
import { downloadCsv } from "../utils/csv";

const TABS = [
  { key: "uptime", label: "Uptime por dispositivo" },
  { key: "availability", label: "Disponibilidad por grupo" },
  { key: "errors", label: "Errores" },
  { key: "proofOfPlay", label: "Proof of play" },
];

export default function Reports() {
  const [tab, setTab] = useState(TABS[0].key); // default: first tab preselected
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
      <h1>Reportes</h1>

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
          <label>
            Dias:
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={7}>7</option>
              <option value={30}>30</option>
              <option value={90}>90</option>
            </select>
          </label>
        ) : (
          <label>
            Ventana:
            <select className="input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              <option value={24}>24 horas</option>
              <option value={168}>7 dias</option>
            </select>
          </label>
        )}
        <button className="btn" onClick={load}>
          Refrescar
        </button>
        <button className="btn btn-primary" onClick={exportCsv} disabled={rows.length === 0}>
          Exportar CSV
        </button>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}
      {loading ? (
        <div className="center-page">Cargando reporte...</div>
      ) : rows.length === 0 ? (
        <p className="hint">Sin datos para este rango.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className="truncate">
                    {String(row[c] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
