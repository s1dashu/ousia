import { builtinModules } from "node:module"
import { defineConfig } from "vite"
import {
  desktopSentryVite,
  loadDesktopSentryEnvironment,
} from "./src/electron/sentry-vite-build"

const external = [
  "bufferutil",
  "electron",
  "esbuild",
  "utf-8-validate",
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
    resolve: {
      // pi-coding-agent ships a nested copy of the exact same pi-ai version.
      // Force one module graph so provider implementations are not emitted twice.
      dedupe: ["@earendil-works/pi-ai"],
    },
    build: {
      sourcemap: sentry.sourcemap,
      rollupOptions: {
        external,
        output: {
          chunkFileNames: "[name].js",
        },
      },
    },
  }
})
