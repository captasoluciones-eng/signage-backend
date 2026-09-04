import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [error, setError] = useState(null);

  if (loading) return <div className="center-page">Cargando...</div>;
  if (user) return <Navigate to="/" replace />;

  const handleSignIn = async () => {
    setError(null);
    try {
      await signIn();
    } catch (err) {
      // auth/popup-closed-by-user / auth/cancelled-popup-request just mean
      // the user dismissed it -- not worth showing as an error.
      if (err?.code !== "auth/popup-closed-by-user" && err?.code !== "auth/cancelled-popup-request") {
        setError("No se pudo iniciar sesion. Intenta de nuevo.");
      }
    }
  };

  return (
    <div className="center-page login-page">
      <div className="login-card">
        <h1>Signage Admin</h1>
        <p>Panel de administracion de senaletica digital.</p>
        <button className="btn btn-primary" onClick={handleSignIn}>
          Iniciar sesion con Google
        </button>
        {error && <p className="error-banner">{error}</p>}
        <p className="hint">
          Solo cuentas autorizadas (allow-list del servidor) pueden acceder al panel.
        </p>
      </div>
    </div>
  );
}
