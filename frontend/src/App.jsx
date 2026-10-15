import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import Pairing from "./pages/Pairing";
import Groups from "./pages/Groups";
import Playlists from "./pages/Playlists";
import Assets from "./pages/Assets";
import Reports from "./pages/Reports";
import Usuarios from "./pages/Usuarios";
import Publicar from "./pages/rh/Publicar";
import Publicaciones from "./pages/rh/Publicaciones";
import VistaPrevia from "./pages/rh/VistaPrevia";

// Páginas de administración: solo rol admin. RH y "solo consulta" ven su sección.
const soloAdmin = (el) => <ProtectedRoute roles={["admin"]}>{el}</ProtectedRoute>;
const publican = (el) => <ProtectedRoute roles={["admin", "rh"]}>{el}</ProtectedRoute>;

export default function App() {
  const { user } = useAuth();

  // Log a lightweight session/tracking breadcrumb per the "every dashboard
  // needs login/session/tracking" directive. The API client's ID token
  // getter is wired up in AuthContext itself, synchronously with the auth
  // state change -- not here -- to avoid a mount-order race with pages that
  // fetch data on mount (see AuthContext.jsx).
  useEffect(() => {
    if (user) {
      console.info("[signage-admin] session start", {
        uid: user.uid,
        email: user.email,
        at: new Date().toISOString(),
      });
    }
  }, [user]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={soloAdmin(<Dashboard />)} />
        <Route path="/devices" element={soloAdmin(<Devices />)} />
        <Route path="/pairing" element={soloAdmin(<Pairing />)} />
        <Route path="/groups" element={soloAdmin(<Groups />)} />
        <Route path="/playlists" element={soloAdmin(<Playlists />)} />
        <Route path="/assets" element={soloAdmin(<Assets />)} />
        <Route path="/reports" element={soloAdmin(<Reports />)} />
        <Route path="/usuarios" element={soloAdmin(<Usuarios />)} />
        <Route path="/rh/publicar" element={publican(<Publicar />)} />
        <Route path="/rh/publicaciones" element={<Publicaciones />} />
        <Route path="/rh/vista-previa" element={<VistaPrevia />} />
      </Route>
    </Routes>
  );
}
