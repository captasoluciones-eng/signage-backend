import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useLiveDevices } from "../hooks/useLiveDevices";

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { liveById } = useLiveDevices();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.dashboardSummary();
      setSummary(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Default sensible refresh: every 30s, on top of the realtime Firestore feed.
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // Merge live Firestore state on top of the REST snapshot for a live feel.
  const devicesByLocation = useMemo(() => {
    if (!summary) return [];
    return summary.devicesByLocation.map((d) => ({
      ...d,
      ...(liveById[d.deviceId] || {}),
    }));
  }, [summary, liveById]);

  if (loading && !summary) return <div className="center-page">Cargando dashboard...</div>;
  if (error) return <div className="error-banner">Error: {error}</div>;
  if (!summary) return null;

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="stat-grid">
        <StatCard label="Total de pantallas" value={summary.total} />
        <StatCard label="En linea" value={summary.online} tone="ok" />
        <StatCard label="Fuera de linea" value={summary.offline} tone="danger" />
        <StatCard label="Pendientes de vincular" value={summary.pendiente} tone="warn" />
        <StatCard label="Deshabilitadas" value={summary.deshabilitado} tone="muted" />
      </div>

      <section className="panel">
        <h2>Dispositivos por ubicacion</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th>Ubicacion</th>
              <th>Estado</th>
              <th>En linea</th>
            </tr>
          </thead>
          <tbody>
            {devicesByLocation.map((d) => (
              <tr key={d.deviceId}>
                <td>{d.nombre || d.deviceId}</td>
                <td>{d.ubicacion || "-"}</td>
                <td>{d.estado}</td>
                <td>
                  <span className={"dot " + (d.online ? "dot-ok" : "dot-danger")} />
                  {d.online ? "Si" : "No"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Top errores (ultimas 24h)</h2>
        {summary.topErrorsLast24h.length === 0 ? (
          <p className="hint">Sin errores registrados en las ultimas 24 horas.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Tipo</th>
                <th>URL</th>
                <th>Errores</th>
              </tr>
            </thead>
            <tbody>
              {summary.topErrorsLast24h.map((row) => (
                <tr key={row.itemId}>
                  <td>{row.itemId}</td>
                  <td>{row.tipo}</td>
                  <td className="truncate">{row.url}</td>
                  <td>{row.errores}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, tone = "default" }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
