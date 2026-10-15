import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/** Sin sesión -> /login. Con sesión pero sin acceso al panel -> /login (muestra el aviso).
 * `roles`: si se da, solo esos roles entran; los demás van a su página de inicio. */
export default function ProtectedRoute({ children, roles }) {
  const { user, perfil, loading } = useAuth();

  if (loading) {
    return <div className="center-page">Cargando sesión...</div>;
  }
  if (!user || !perfil) {
    return <Navigate to="/login" replace />;
  }
  if (roles && !roles.includes(perfil.rol)) {
    return <Navigate to={perfil.rol === "admin" ? "/" : "/rh/publicaciones"} replace />;
  }
  return children;
}
