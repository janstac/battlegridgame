import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Vite configuration for the standalone browser demo. */
export default defineConfig({
  plugins: [react()],
});
