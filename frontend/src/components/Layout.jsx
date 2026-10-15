import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  IconDashboard,
  IconScreen,
  IconLink,
  IconGroups,
  IconPlaylist,
  IconAssets,
  IconReports,
  IconLogout,
  IconLogo,
  IconUsers,
  IconMegaphone,
} from "./Icons";

// Recursos humanos: RH y administradores publican; "lectura" solo ve.
const NAV_RH = [
  { to: "/rh/publicar", label: "Publicar", Icon: IconMegaphone, roles: ["admin", "rh"] },
  { to: "/rh/publicaciones", label: "Publicaciones", Icon: IconPlaylist, roles: ["admin", "rh", "lectura"] },
  { to: "/rh/vista-previa", label: "Vista previa", Icon: IconScreen, roles: ["admin", "rh", "lectura"] },
];
const NAV_ADMIN = [
  { to: "/", label: "Inicio", end: true, Icon: IconDashboard },
  { to: "/devices", label: "Pantallas", Icon: IconScreen },
  { to: "/pairing", label: "Vinculación", Icon: IconLink },
  { to: "/groups", label: "Grupos", Icon: IconGroups },
  { to: "/playlists", label: "Playlists", Icon: IconPlaylist },
  { to: "/assets", label: "Recursos", Icon: IconAssets },
  { to: "/reports", label: "Reportes", Icon: IconReports },
  { to: "/usuarios", label: "Usuarios", Icon: IconUsers },
];
const ROL_TXT = { admin: "Administrador", rh: "Recursos humanos", lectura: "Solo consulta" };

function Enlace({ to, label, end, Icon }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
      <Icon width={18} height={18} />
      {label}
    </NavLink>
  );
}

export default function Layout() {
  const { user, rol, signOut } = useAuth();
  const inicial = (user?.email || "?").charAt(0);
  const rh = NAV_RH.filter((i) => i.roles.includes(rol));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true">
            <IconLogo width={20} height={20} />
          </span>
          CaptaVision
        </div>
        <nav>
          {!!rh.length && <div className="nav-titulo">Recursos humanos</div>}
          {rh.map((i) => <Enlace key={i.to} {...i} />)}
          {rol === "admin" && (
            <>
              <div className="nav-titulo">Administración</div>
              {NAV_ADMIN.map((i) => <Enlace key={i.to} {...i} />)}
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="user-email">
            <span className="user-avatar" aria-hidden="true">
              {inicial}
            </span>
            <span>
              {user?.email}
              <small className="user-rol">{ROL_TXT[rol] || ""}</small>
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            <IconLogout width={16} height={16} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
