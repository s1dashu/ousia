import { autoUpdater, type BrowserWindow } from "electron"
import { arch, platform } from "node:process"

import type {
  OusiaChatContext,
  OusiaChatEvent,
  OusiaUpdateActionResult,
  OusiaUpdateStatus,
} from "./chat-types.js"
import { writeRuntimeLog } from "./runtime-logger.js"

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const IDLE_INSTALL_DELAY_MS = 5 * 60 * 1000
const IDLE_POLL_MS = 30 * 1000

type LatestRelease = {
  version: string
  releaseName: string
}

type UpdateManagerOptions = {
  currentVersion: string
  fetchRelease?: typeof fetch
  isPackaged: boolean
  serviceBaseUrl: string
  getWindow: () => BrowserWindow | undefined
  now?: () => number
  onDownloaded?: () => void
}

function compareVersions(left: string, right: string) {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10))
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

export function createUpdateManager({
  currentVersion,
  fetchRelease = fetch,
  getWindow,
  isPackaged,
  serviceBaseUrl,
  now = Date.now,
  onDownloaded,
}: UpdateManagerOptions) {
  let status: OusiaUpdateStatus = isPackaged
    ? { phase: "idle", currentVersion }
    : { phase: "disabled", reason: "Updates are available in packaged builds." }
  let lastActivityAt = now()
  let checkTimer: ReturnType<typeof setInterval> | undefined
  let idleTimer: ReturnType<typeof setInterval> | undefined
  let downloadInFlight: Promise<OusiaUpdateActionResult> | undefined
  const runningSessions = new Set<string>()

  function publish(next: OusiaUpdateStatus) {
    status = next
    getWindow()?.webContents.send("ousia:update:status", next)
    writeRuntimeLog(
      "update.state",
      next.phase === "error" ? "error" : "info",
      next
    )
  }

  function installIfIdle() {
    if (status.phase !== "downloaded") return
    const window = getWindow()
    const focused = Boolean(
      window && !window.isDestroyed() && window.isFocused()
    )
    if (
      focused ||
      runningSessions.size > 0 ||
      now() - lastActivityAt < IDLE_INSTALL_DELAY_MS
    ) {
      return
    }
    writeRuntimeLog("update.install", "info", {
      reason: "idle",
      version: status.version,
    })
    autoUpdater.quitAndInstall()
  }

  autoUpdater.on("error", (error) => {
    publish({
      phase: "error",
      currentVersion,
      message: error.message,
      ...(status.phase === "downloading" ? { version: status.version } : {}),
    })
  })
  autoUpdater.on("update-downloaded", (_event, _notes, releaseName) => {
    const version =
      status.phase === "downloading"
        ? status.version
        : releaseName.replace(/^v/, "")
    publish({ phase: "downloaded", currentVersion, version })
    onDownloaded?.()
    idleTimer ??= setInterval(installIfIdle, IDLE_POLL_MS)
    installIfIdle()
  })

  async function check(
    source: "startup" | "interval" | "manual" | "download-retry" = "manual"
  ): Promise<OusiaUpdateStatus> {
    if (!isPackaged || !serviceBaseUrl) return status
    if (status.phase === "downloading" || status.phase === "downloaded") {
      return status
    }
    writeRuntimeLog("update.check", "info", {
      arch,
      currentVersion,
      platform,
      source,
    })
    try {
      const url = new URL("/api/releases/latest", serviceBaseUrl)
      url.searchParams.set("platform", platform)
      url.searchParams.set("arch", arch)
      const response = await fetchRelease(url.toString(), {
        headers: { "user-agent": `Ousia/${currentVersion}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        throw new Error(`Release check failed with HTTP ${response.status}`)
      }
      const release = (await response.json()) as LatestRelease
      if (!release.version || !release.releaseName) {
        throw new Error("Release service returned an invalid response")
      }
      writeRuntimeLog("update.check", "info", {
        currentVersion,
        latestVersion: release.version,
        source,
      })
      if (compareVersions(release.version, currentVersion) <= 0) {
        publish({ phase: "idle", currentVersion })
        return status
      }
      publish({
        phase: "available",
        currentVersion,
        version: release.version,
        releaseName: release.releaseName,
      })
      return status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publish({
        phase: "error",
        currentVersion,
        message,
        ...(status.phase === "available" || status.phase === "error"
          ? { version: status.version }
          : {}),
      })
      return status
    }
  }

  async function performDownload(): Promise<OusiaUpdateActionResult> {
    if (status.phase !== "available" && status.phase !== "error") {
      writeRuntimeLog("update.download.rejected", "error", {
        phase: status.phase,
      })
      return {
        ok: false,
        error: `Cannot download from update phase: ${status.phase}`,
      }
    }
    let targetVersion = status.version
    if (!targetVersion) {
      publish({ phase: "checking", currentVersion })
      await check("download-retry")
      const refreshedStatus: OusiaUpdateStatus = status
      if (refreshedStatus.phase !== "available") {
        return { ok: false, error: "No update is currently available." }
      }
      targetVersion = refreshedStatus.version
    }
    const feedUrl = new URL(
      `/api/updates/${platform}/${arch}/${encodeURIComponent(currentVersion)}`,
      serviceBaseUrl
    )
    autoUpdater.setFeedURL({ url: feedUrl.toString(), serverType: "json" })
    publish({ phase: "downloading", currentVersion, version: targetVersion })
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publish({
        phase: "error",
        currentVersion,
        message,
        version: targetVersion,
      })
      return { ok: false, error: message }
    }
  }

  function download(): Promise<OusiaUpdateActionResult> {
    if (downloadInFlight) {
      writeRuntimeLog("update.download.joined", "info", {
        phase: status.phase,
      })
      return downloadInFlight
    }
    const operation = performDownload()
    downloadInFlight = operation
    const clearOperation = () => {
      if (downloadInFlight === operation) downloadInFlight = undefined
    }
    void operation.then(clearOperation, clearOperation)
    return operation
  }

  function install(): OusiaUpdateActionResult {
    if (status.phase !== "downloaded") {
      return { ok: false, error: "The update has not finished downloading." }
    }
    writeRuntimeLog("update.install", "info", {
      reason: "user",
      version: status.version,
    })
    autoUpdater.quitAndInstall()
    return { ok: true }
  }

  function observeChatEvent(event: OusiaChatEvent, context?: OusiaChatContext) {
    if (event.type !== "run_status" || !context?.sessionId) return
    if (event.status === "starting" || event.status === "running") {
      runningSessions.add(context.sessionId)
    } else {
      runningSessions.delete(context.sessionId)
      installIfIdle()
    }
  }

  return {
    check,
    dispose() {
      if (checkTimer) clearInterval(checkTimer)
      if (idleTimer) clearInterval(idleTimer)
      autoUpdater.removeAllListeners()
    },
    download,
    getStatus: () => status,
    install,
    noteActivity() {
      lastActivityAt = now()
    },
    observeChatEvent,
    start() {
      if (!isPackaged || !serviceBaseUrl) return
      void check("startup")
      checkTimer ??= setInterval(
        () => void check("interval"),
        CHECK_INTERVAL_MS
      )
    },
  }
}

export { compareVersions }
