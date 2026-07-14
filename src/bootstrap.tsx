import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import "./index.css"
import "./tauri/api.ts"

const root = document.getElementById("root")
if (!root) {
  throw new Error("Missing #root mount element.")
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="ousia.theme">
      <App />
    </ThemeProvider>
  </StrictMode>
)
