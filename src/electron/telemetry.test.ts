import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const { writeRuntimeLog } = vi.hoisted(() => ({ writeRuntimeLog: vi.fn() }))
vi.mock("./runtime-logger.js", () => ({ writeRuntimeLog }))

import { createTelemetry } from "./telemetry.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe("createTelemetry", () => {
  it("reports delivery failures through the handled-error boundary", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "ousia-telemetry-"))
    temporaryDirectories.push(userDataPath)
    const captureError = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable")
      })
    )
    const telemetry = createTelemetry({
      appVersion: "1.2.3",
      captureError,
      serviceBaseUrl: "https://telemetry.example.test",
      userDataPath,
    })

    telemetry.record("app_opened")
    await vi.waitFor(() => expect(captureError).toHaveBeenCalledOnce())
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      errorCode: "telemetry.delivery_failed",
      operation: "deliver",
      retryable: true,
      subsystem: "telemetry",
    })
    expect(writeRuntimeLog).toHaveBeenCalledWith(
      "telemetry",
      "warn",
      expect.objectContaining({ event: "app_opened" })
    )
  })
})
