import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { arch, platform } from "node:process"
import { join } from "node:path"

import { writeRuntimeLog } from "./runtime-logger.js"
import {
  captureDesktopHandledError,
  type DesktopHandledErrorContext,
} from "./sentry-handled-errors.js"

type TelemetryOptions = {
  appVersion: string
  serviceBaseUrl: string
  userDataPath: string
  captureError?: (
    error: unknown,
    context: DesktopHandledErrorContext
  ) => unknown
}

function installationId(userDataPath: string) {
  const path = join(userDataPath, "installation-id")
  if (existsSync(path)) {
    const value = readFileSync(path, "utf8").trim()
    if (!value) throw new Error(`Empty installation id: ${path}`)
    return value
  }
  const value = randomUUID()
  writeFileSync(path, `${value}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  })
  return value
}

export function createTelemetry({
  appVersion,
  serviceBaseUrl,
  userDataPath,
  captureError = captureDesktopHandledError,
}: TelemetryOptions) {
  const installId = installationId(userDataPath)

  async function record(event: "app_opened" | "update_downloaded") {
    if (!serviceBaseUrl) return
    const response = await fetch(new URL("/api/events", serviceBaseUrl), {
      body: JSON.stringify({
        event,
        installationId: installId,
        version: appVersion,
        platform,
        arch,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      throw new Error(`Telemetry failed with HTTP ${response.status}`)
    }
  }

  return {
    record(event: "app_opened" | "update_downloaded") {
      void record(event).catch((error) => {
        captureError(error, {
          errorCode: "telemetry.delivery_failed",
          operation: "deliver",
          retryable: true,
          subsystem: "telemetry",
        })
        writeRuntimeLog("telemetry", "warn", {
          event,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    },
  }
}
