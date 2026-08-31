import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function Pairing() {
  const [pairingCode, setPairingCode] = useState("");
  const [nombre, setNombre] = useState("");
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .listGroups()
      .then((gs) => {
        setGroups(gs);
        if (gs.length > 0) setGroupId(gs[0].groupId); // sensible default selection
      })
      .catch((e) => setError(e.message));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await api.pairDevice({ pairingCode: pairingCode.trim(), nombre, groupId });
      setResult(res);
      setPairingCode("");
      setNombre("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Vinculacion de dispositivo</h1>
      <p className="hint">
        Ingresa el codigo de 6 digitos mostrado en la pantalla del TV recien instalado, asignale un
        nombre y un grupo, y se emitira su llave de dispositivo (deviceKey).
      </p>

      <form className="panel form" onSubmit={submit}>
        <label>
          Codigo de vinculacion
          <input
            className="input"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value)}
            maxLength={6}
            pattern="[0-9]{6}"
            required
          />
        </label>
        <label>
          Nombre de la pantalla
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </label>
        <label>
          Grupo
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.nombre}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Vinculando..." : "Vincular dispositivo"}
        </button>
      </form>

      {error && <div className="error-banner">Error: {error}</div>}

      {result && (
        <div className="panel success-panel">
          <h2>Dispositivo vinculado</h2>
          <p>
            <strong>Device ID:</strong> {result.deviceId}
          </p>
          <p>
            <strong>Device Key:</strong> <code>{result.deviceKey}</code>
          </p>
          <p className="hint">
            Esta llave no se vuelve a mostrar automaticamente; guardala si necesitas
            reconfigurar el reproductor manualmente.
          </p>
        </div>
      )}
    </div>
  );
}
