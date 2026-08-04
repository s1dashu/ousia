import { builtinModules } from "node:module"
import { defineConfig } from "vite"
import {
  desktopSentryVite,
  loadDesktopSentryEnvironment,
} from "./src/electron/sentry-vite-build"

const piCodingAgentPackageName = "@earendil-works/pi-coding-agent"
const piCodingAgentRuntimeEntries = new Map([
  [
    piCodingAgentPackageName,
    "../../node_modules/@earendil-works/pi-coding-agent/dist/index.js",
  ],
  [
    `${piCodingAgentPackageName}/rpc-entry`,
    "../../node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js",
  ],
])

const external = [
  /^@earendil-works\/pi-coding-agent(?:\/.*)?$/,
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
    environment: loadDesktopSentryEnvironment({ mode, root: __dirname }),
    envPrefix: "OUSIA",
    productId: "ousia",
    releaseName: "ousia-desktop",
    sourcemapAssets: [
      ".vite/build/**/*.js",
      "!.vite/build/preload.js",
    ],
  })
  return {
    define: sentry.define,
    plugins: sentry.plugins,
    build: {
      sourcemap: sentry.sourcemap,
      rollupOptions: {
        external,
        output: {
          chunkFileNames: "[name].js",
          paths: (id) => {
            const runtimeEntry = piCodingAgentRuntimeEntries.get(id)
            if (runtimeEntry) {
              return runtimeEntry
            }
            if (id.startsWith(`${piCodingAgentPackageName}/`)) {
              throw new Error(
                `No packaged runtime entry is configured for external Pi module: ${id}`
              )
            }
            return id
          },
        },
      },
    },
  }
})
