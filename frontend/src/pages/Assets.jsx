import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

/** Extracts duration (video) via an offscreen <video> element, and a JPEG
 * thumbnail (video: first frame; imagen: the image itself) as a data URL.
 * Runs entirely client-side before upload -- no extra backend endpoint. */
function extractVideoMeta(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 180;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.7);
      resolve({ durationSec: Math.round(video.duration), thumbnailUrl });
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => resolve({ durationSec: null, thumbnailUrl: null });
  });
}

function inferType(file) {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "imagen";
  return "link";
}

export default function Assets() {
  const [assets, setAssets] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const fileInputRef = useRef(null);

  async function load(q) {
    setLoading(true);
    setError(null);
    try {
      setAssets(await api.listAssets(q));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSearchChange(value) {
    setSearch(value);
    await load(value);
  }

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const tipo = inferType(file);
      setProgressLabel("Extrayendo metadata...");
      let durationSec = null;
      let thumbnailUrl = null;
      if (tipo === "video") {
        const meta = await extractVideoMeta(file);
        durationSec = meta.durationSec;
        thumbnailUrl = meta.thumbnailUrl;
      } else if (tipo === "imagen") {
        thumbnailUrl = URL.createObjectURL(file);
      }

      setProgressLabel("Solicitando URL firmada...");
      const { uploadUrl, gcsPath, cdnUrl } = await api.getSignedUploadUrl(file.name, file.type);

      setProgressLabel("Subiendo a Cloud Storage...");
      await api.uploadToSignedUrl(uploadUrl, file, file.type);

      setProgressLabel("Guardando metadata...");
      await api.createAsset({
        nombre: file.name,
        tipo,
        gcsPath,
        cdnUrl,
        bytes: file.size,
        duracionSec: durationSec,
        thumbnailUrl,
      });

      await load(search);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      setProgressLabel("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (loading) return <div className="center-page">Cargando assets...</div>;

  return (
    <div>
      <h1>Assets</h1>
      {error && <div className="error-banner">Error: {error}</div>}

      <div className="toolbar">
        <input
          className="input"
          placeholder="Buscar assets..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <label className="btn btn-primary upload-btn">
          {uploading ? progressLabel || "Subiendo..." : "Subir archivo"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={onFileSelected}
            disabled={uploading}
            hidden
          />
        </label>
      </div>

      <div className="asset-grid">
        {assets.map((a) => (
          <div key={a.assetId} className="asset-card">
            {a.thumbnailUrl ? (
              <img src={a.thumbnailUrl} alt={a.nombre} className="asset-thumb" />
            ) : (
              <div className="asset-thumb asset-thumb-placeholder">{a.tipo}</div>
            )}
            <div className="asset-meta">
              <div className="asset-name truncate" title={a.nombre}>
                {a.nombre}
              </div>
              <div className="hint">
                {a.tipo} {a.duracionSec ? `- ${a.duracionSec}s` : ""}{" "}
                {a.bytes ? `- ${(a.bytes / 1024 / 1024).toFixed(2)} MB` : ""}
              </div>
              <a href={a.cdnUrl} target="_blank" rel="noreferrer" className="hint truncate">
                {a.cdnUrl}
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
