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
  IconMagic,
  IconLogo,
} from "./Icons";

const NAV_ITEMS = [
  { to: "/", label: "Inicio", end: true, Icon: IconDashboard },
  { to: "/studio", label: "Crear contenido", Icon: IconMagic },
  { to: "/devices", label: "Pantallas", Icon: IconScreen },
  { to: "/pairing", label: "Vinculación", Icon: IconLink },
  { to: "/groups", label: "Grupos", Icon: IconGroups },
  { to: "/playlists", label: "Playlists", Icon: IconPlaylist },
  { to: "/assets", label: "Recursos", Icon: IconAssets },
  { to: "/reports", label: "Reportes", Icon: IconReports },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const inicial = (user?.email || "?").charAt(0);

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
          {NAV_ITEMS.map(({ to, label, end, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            >
              <Icon width={18} height={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-email">
            <span className="user-avatar" aria-hidden="true">
              {inicial}
            </span>
            {user?.email}
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
