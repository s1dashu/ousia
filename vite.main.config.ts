import { builtinModules } from "node:module"
import { defineConfig } from "vite"

const external = [
  "electron",
  "esbuild",
  "node-pty",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]

export default defineConfig({
  build: {
    rollupOptions: {
      external,
    },
  },
})
