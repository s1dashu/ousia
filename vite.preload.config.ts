import { builtinModules } from "node:module"
import { defineConfig } from "vite"
import {
  desktopSentryVite,
  loadDesktopSentryEnvironment,
} from "./src/electron/sentry-vite-build"

const external = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]

export default defineConfig(({ command, mode }) => {
  const sentry = desktopSentryVite({
    command,
    environment: loadDesktopSentryEnvironment({ mode }),
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
