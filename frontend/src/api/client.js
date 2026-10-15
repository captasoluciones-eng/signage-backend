const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

let currentIdTokenGetter = null;

/** Called once from App.jsx so the API client can always attach a fresh
 * Firebase ID token without every call site having to pass it explicitly. */
export function registerIdTokenGetter(getter) {
  currentIdTokenGetter = getter;
}

const RETRY_DELAYS_MS = [300, 800];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const finalHeaders = { "Content-Type": "application/json", ...headers };
  if (auth && currentIdTokenGetter) {
    const token = await currentIdTokenGetter();
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  // GET requests are safe to retry silently: a "Failed to fetch" here means
  // the request never reached the server (a transient network blip, e.g.
  // wifi reconnecting), not a server-side failure -- retrying a write isn't
  // safe the same way, since the original attempt may have already gone
  // through server-side before the response got lost.
  const maxAttempts = method === "GET" ? RETRY_DELAYS_MS.length + 1 : 1;

  let res;
  let lastNetworkError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      lastNetworkError = null;
      break;
    } catch (e) {
      lastNetworkError = e;
    }
  }
  if (lastNetworkError) throw lastNetworkError;

  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // FastAPI manda los errores de validación (422) como lista de objetos.
    const detail = data && data.detail;
    const message =
      (Array.isArray(detail) ? detail.map((d) => d.msg).join("; ") : detail) ||
      (data && data.message) ||
      res.statusText;
    throw new Error(`${res.status} ${message}`);
  }
  return data;
}

export const api = {
  // Devices
  listDevices: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/devices${qs ? `?${qs}` : ""}`);
  },
  getDevice: (deviceId) => request(`/admin/devices/${deviceId}`),
  pairDevice: (payload) => request("/admin/pairing", { method: "POST", body: payload }),
  sendCommand: (deviceId, command) =>
    request(`/admin/devices/${deviceId}/command`, { method: "POST", body: { command } }),
  bulkCommand: (payload) => request("/admin/devices/bulk-command", { method: "POST", body: payload }),
  setOverlay: (deviceId, overlay) =>
    request(`/admin/devices/${deviceId}/overlay`, { method: "POST", body: overlay }),
  reassignGroup: (deviceId, groupId) =>
    request(`/admin/devices/${deviceId}/reassign-group`, { method: "POST", body: { groupId } }),
  setDisabled: (deviceId, disabled) =>
    request(`/admin/devices/${deviceId}/disable`, { method: "POST", body: { disabled } }),
  setPlaylistOverride: (deviceId, playlistId) =>
    request(`/admin/devices/${deviceId}/playlist-override`, {
      method: "POST",
      body: { playlistId },
    }),

  // Groups
  listGroups: () => request("/admin/groups"),
  createGroup: (payload) => request("/admin/groups", { method: "POST", body: payload }),
  updateGroup: (groupId, payload) =>
    request(`/admin/groups/${groupId}`, { method: "PUT", body: payload }),
  deleteGroup: (groupId) => request(`/admin/groups/${groupId}`, { method: "DELETE" }),

  // Playlists
  listPlaylists: () => request("/admin/playlists"),
  getPlaylist: (playlistId) => request(`/admin/playlists/${playlistId}`),
  createPlaylist: (payload) => request("/admin/playlists", { method: "POST", body: payload }),
  updatePlaylist: (playlistId, payload) =>
    request(`/admin/playlists/${playlistId}`, { method: "PUT", body: payload }),
  deletePlaylist: (playlistId) => request(`/admin/playlists/${playlistId}`, { method: "DELETE" }),

  // Assets
  listAssets: (search) => request(`/admin/assets${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  getSignedUploadUrl: (filename, contentType) =>
    request("/admin/assets/signed-upload-url", {
      method: "POST",
      body: { filename, contentType },
    }),
  createAsset: (payload) => request("/admin/assets", { method: "POST", body: payload }),
  deleteAsset: (assetId) => request(`/admin/assets/${assetId}`, { method: "DELETE" }),

  // RH announcement (Content Studio "Convivencia" mode)
  getRHAnnouncement: (groupId) => request(`/admin/rh-announcement/${groupId}`),
  upsertRHAnnouncement: (groupId, payload) =>
    request(`/admin/rh-announcement/${groupId}`, { method: "PUT", body: payload }),
  deleteRHAnnouncement: (groupId) =>
    request(`/admin/rh-announcement/${groupId}`, { method: "DELETE" }),

  // Reports
  reportUptime: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/reports/uptime${qs ? `?${qs}` : ""}`);
  },
  reportAvailabilityByGroup: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/reports/availability-by-group${qs ? `?${qs}` : ""}`);
  },
  reportErrors: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/reports/errors${qs ? `?${qs}` : ""}`);
  },
  reportProofOfPlay: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/reports/proof-of-play${qs ? `?${qs}` : ""}`);
  },

  // Dashboard
  dashboardSummary: () => request("/admin/dashboard/summary"),
  whoami: () => request("/admin/whoami"),
  me: () => request("/me"),

  // Recursos humanos (publica en el Sheet de contenido a través del backend)
  rhSucursales: () => request("/rh/sucursales"),
  rhPantallas: () => request("/rh/pantallas"),
  rhPublicaciones: () => request("/rh/publicaciones"),
  rhPublicar: (payload) => request("/rh/publicaciones", { method: "POST", body: payload }),
  rhActualizar: (id, cambios) =>
    request(`/rh/publicaciones/${encodeURIComponent(id)}`, { method: "PATCH", body: cambios }),
  rhDuplicar: (id) => request(`/rh/publicaciones/${encodeURIComponent(id)}/duplicar`, { method: "POST" }),
  rhFondos: () => request("/rh/fondos"),
  rhGuardarFondo: (nombre, url) => request("/rh/fondos", { method: "POST", body: { nombre, url } }),
  rhBorrarFondo: (id) => request(`/rh/fondos/${encodeURIComponent(id)}`, { method: "DELETE" }),
  rhUploadUrl: (filename, contentType) =>
    request("/rh/upload-url", { method: "POST", body: { filename, contentType } }),

  // Usuarios del panel (solo administradores)
  listUsuarios: () => request("/admin/usuarios"),
  crearUsuario: (payload) => request("/admin/usuarios", { method: "POST", body: payload }),
  linkContrasena: (email) =>
    request(`/admin/usuarios/${encodeURIComponent(email)}/link-contrasena`, { method: "POST" }),
  editarUsuario: (email, cambios) =>
    request(`/admin/usuarios/${encodeURIComponent(email)}`, { method: "PATCH", body: cambios }),

  // Direct upload to a GCS signed URL (not through the API server).
  uploadToSignedUrl: async (uploadUrl, file, contentType) => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  },
};
