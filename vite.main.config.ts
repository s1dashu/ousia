import { builtinModules } from "node:module"
import { defineConfig } from "vite"

const external = [
  "bufferutil",
  "electron",
  "esbuild",
  "utf-8-validate",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]

export default defineConfig({
  resolve: {
    // pi-coding-agent ships a nested copy of the exact same pi-ai version.
    // Force one module graph so provider implementations are not emitted twice.
    dedupe: ["@earendil-works/pi-ai"],
  },
  build: {
    rollupOptions: {
      external,
      output: {
        chunkFileNames: "[name].js",
      },
    },
  },
})
