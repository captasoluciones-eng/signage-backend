const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

let currentIdTokenGetter = null;

/** Called once from App.jsx so the API client can always attach a fresh
 * Firebase ID token without every call site having to pass it explicitly. */
export function registerIdTokenGetter(getter) {
  currentIdTokenGetter = getter;
}

async function request(path, { method = "GET", body, auth = true, headers = {} } = {}) {
  const finalHeaders = { "Content-Type": "application/json", ...headers };
  if (auth && currentIdTokenGetter) {
    const token = await currentIdTokenGetter();
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = (data && (data.detail || data.message)) || res.statusText;
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
