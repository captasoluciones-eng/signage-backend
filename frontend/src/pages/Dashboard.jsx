import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useLiveDevices } from "../hooks/useLiveDevices";
import {
  IconTotal,
  IconOnline,
  IconOffline,
  IconPending,
  IconDisabled,
} from "../components/Icons";

const ESTADO_LABEL = {
  activo: "Activo",
  pendiente: "Pendiente",
  deshabilitado: "Deshabilitado",
};

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
    // Refresco periódico cada 30s, además del feed en tiempo real de Firestore.
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const devicesByLocation = useMemo(() => {
    if (!summary) return [];
    return summary.devicesByLocation.map((d) => ({
      ...d,
      ...(liveById[d.deviceId] || {}),
    }));
  }, [summary, liveById]);

  if (loading && !summary) return <div className="center-page">Cargando resumen…</div>;
  if (error) return <div className="error-banner">Error: {error}</div>;
  if (!summary) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Resumen general</h1>
          <div className="page-sub">Estado de todas las pantallas en tiempo real.</div>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Total de pantallas" value={summary.total} Icon={IconTotal} />
        <StatCard label="En línea" value={summary.online} tone="ok" Icon={IconOnline} />
        <StatCard label="Fuera de línea" value={summary.offline} tone="danger" Icon={IconOffline} />
        <StatCard label="Pendientes de vincular" value={summary.pendiente} tone="warn" Icon={IconPending} />
        <StatCard label="Deshabilitadas" value={summary.deshabilitado} tone="muted" Icon={IconDisabled} />
      </div>

      <section className="panel">
        <h2>Pantallas por ubicación</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pantalla</th>
                <th>Ubicación</th>
                <th>Estado</th>
                <th>Conexión</th>
              </tr>
            </thead>
            <tbody>
              {devicesByLocation.map((d) => (
                <tr key={d.deviceId}>
                  <td className="cell-strong">{d.nombre || d.deviceId}</td>
                  <td className="cell-muted">{d.ubicacion || "—"}</td>
                  <td>
                    <span className={"badge badge-" + d.estado}>{ESTADO_LABEL[d.estado] || d.estado}</span>
                  </td>
                  <td>
                    {d.estado === "activo" ? (
                      <span className={"status-pill " + (d.online ? "is-online" : "is-offline")}>
                        <span className="dot" />
                        {d.online ? "En línea" : "Desconectada"}
                      </span>
                    ) : (
                      // "En línea/Fuera de línea" solo aplica a pantallas activas
                      // (igual que el contador de arriba: online = online && activo).
                      // Una pantalla deshabilitada o pendiente que siga latiendo no
                      // debe pintarse como "En línea": ensucia el panel.
                      <span className="cell-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {devicesByLocation.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">Aún no hay pantallas registradas.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Errores más frecuentes (últimas 24 h)</h2>
        {summary.topErrorsLast24h.length === 0 ? (
          <p className="hint">Sin errores registrados en las últimas 24 horas. Todo en orden.</p>
        ) : (
          <div className="table-scroll">
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
                    <td className="cell-muted">{row.tipo}</td>
                    <td className="truncate cell-muted">{row.url}</td>
                    <td className="cell-strong">{row.errores}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, tone = "default", Icon }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-top">
        <div className="stat-value">{value}</div>
        {Icon && (
          <span className="stat-icon" aria-hidden="true">
            <Icon width={18} height={18} />
          </span>
        )}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
