import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In dev, proxy API calls to a locally-running backend
      // (uvicorn app.main:app --port 8080) so the browser doesn't hit CORS.
      "/admin": "http://localhost:8080",
      "/playlist": "http://localhost:8080",
      "/register": "http://localhost:8080",
      "/heartbeat": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
  },
});
