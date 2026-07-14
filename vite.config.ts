import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // Tauri serves production assets from a custom scheme. Relative asset URLs
  // keep the bundle independent of an HTTP origin and work in the packaged app.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  worker: {
    format: "es",
  },
  server: {
    strictPort: true,
  },
})
