import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { initializeDesktopSentryRenderer } from "./electron/sentry-renderer.ts"
import { requireDesktopSentryConfig } from "./electron/sentry-config.ts"

initializeDesktopSentryRenderer(
  requireDesktopSentryConfig(__DESKTOP_SENTRY_CONFIG__),
  "renderer"
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="ousia.theme">
      <App />
    </ThemeProvider>
  </StrictMode>
)
