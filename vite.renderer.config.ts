import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { desktopSentryVite } from "./src/electron/sentry-vite-build"

export default defineConfig(({ command }) => {
  const sentry = desktopSentryVite({
    command,
    envPrefix: "OUSIA",
    productId: "ousia",
    releaseName: "ousia-desktop",
  })
  return {
  define: sentry.define,
  plugins: [react(), tailwindcss(), ...sentry.plugins],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: { sourcemap: sentry.sourcemap },
  }
})
