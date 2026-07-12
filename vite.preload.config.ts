import { builtinModules } from "node:module"
import { defineConfig } from "vite"
import { desktopSentryVite } from "./src/electron/sentry-vite-build"

const external = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]

export default defineConfig(({ command }) => {
  const sentry = desktopSentryVite({
    command,
    envPrefix: "OUSIA",
    productId: "ousia",
    releaseName: "ousia-desktop",
  })
  return {
  define: sentry.define,
  plugins: sentry.plugins,
  build: {
    sourcemap: sentry.sourcemap,
    rollupOptions: {
      external,
    },
  },
  }
})
