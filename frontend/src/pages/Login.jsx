import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { user, loading, signIn } = useAuth();

  if (loading) return <div className="center-page">Cargando...</div>;
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="center-page login-page">
      <div className="login-card">
        <h1>Signage Admin</h1>
        <p>Panel de administracion de senaletica digital.</p>
        <button className="btn btn-primary" onClick={signIn}>
          Iniciar sesion con Google
        </button>
        <p className="hint">
          Solo cuentas autorizadas (allow-list del servidor) pueden acceder al panel.
        </p>
      </div>
    </div>
  );
}
