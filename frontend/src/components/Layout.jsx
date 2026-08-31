import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/devices", label: "Dispositivos" },
  { to: "/pairing", label: "Vinculacion" },
  { to: "/groups", label: "Grupos" },
  { to: "/playlists", label: "Playlists" },
  { to: "/assets", label: "Assets" },
  { to: "/reports", label: "Reportes" },
];

export default function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Signage Admin</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-email">{user?.email}</div>
          <button className="btn btn-ghost" onClick={signOut}>
            Cerrar sesion
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
