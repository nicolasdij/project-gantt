import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El proxy manda /api al server. Dentro de Docker, VITE_API_TARGET = http://server:3000
// (nombre de servicio en la red de Compose). En local por defecto apunta a localhost:3000.
const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Necesario para que el hot-reload funcione con volúmenes montados en Docker.
    watch: { usePolling: true },
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
