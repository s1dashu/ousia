import { builtinModules } from "node:module"
import { defineConfig } from "vite"

const external = [
  "electron",
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
