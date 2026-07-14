import { invoke } from "@tauri-apps/api/core"

type FrontendError = {
  kind: "error" | "unhandledrejection" | "bootstrap"
  message: string
  stack?: string
}

function describeUnknownError(error: unknown): Pick<FrontendError, "message" | "stack"> {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack }
  }
  if (typeof error === "string") return { message: error }
  try {
    return { message: JSON.stringify(error) }
  } catch {
    return { message: String(error) }
  }
}

function reportFrontendError(payload: FrontendError) {
  return invoke("report_frontend_error", { payload }).catch((reportingError) => {
    console.error("Failed to persist frontend error", reportingError, payload)
  })
}

window.addEventListener("error", (event) => {
  void reportFrontendError({
    kind: "error",
    message: event.message || "Unknown window error",
    stack: event.error instanceof Error ? event.error.stack : undefined,
  })
})

window.addEventListener("unhandledrejection", (event) => {
  void reportFrontendError({
    kind: "unhandledrejection",
    ...describeUnknownError(event.reason),
  })
})

void import("./bootstrap.tsx").catch(async (error: unknown) => {
  await reportFrontendError({ kind: "bootstrap", ...describeUnknownError(error) })
  throw error
})
