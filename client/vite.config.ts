import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Vite configuration for the browser client and local WebSocket server. */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
});
