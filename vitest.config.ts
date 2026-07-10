import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    coverage: {
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "src/electron/main.ts",
        "src/electron/preload.ts",
        "src/**/*.d.ts",
      ],
      include: [
        "src/app/app-state.ts",
        "src/app/chat-history-state.ts",
        "src/app/model-presets.ts",
        "src/electron/app-state-store.ts",
        "src/electron/chat-event-batcher.ts",
        "src/electron/chat-types.ts",
        "src/electron/host-paths.ts",
        "src/electron/model-compat.ts",
        "src/electron/pi-retry-settings.ts",
        "src/electron/tool-file-preview.ts",
        "src/electron/window-constants.ts",
        "src/features/chat/chat-attachments.ts",
        "src/features/chat/chat-events.ts",
        "src/features/chat/chat-format.ts",
        "src/features/chat/chat-history-clipboard.ts",
        "src/features/chat/chat-provider-readiness.ts",
        "src/features/chat/chat-tool-file-preview.ts",
        "src/features/chat/chat-tool-format.ts",
        "src/features/chat/chat-turn-wait.ts",
        "src/components/ui/tooltip-position.ts",
      ],
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 88,
        statements: 88,
      },
    },
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
