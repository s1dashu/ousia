import { getVersion } from "@tauri-apps/api/app"
import { invoke } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater"

import type {
  OusiaUpdateActionResult,
  OusiaUpdateStatus,
} from "@/electron/chat-types"

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const UPDATE_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

type UpdateListener = (status: OusiaUpdateStatus) => void

let currentVersion: string | undefined
let status: OusiaUpdateStatus = {
  phase: "disabled",
  reason: "The updater has not started.",
}
let availableUpdate: Update | undefined
let downloadedUpdate: Update | undefined
let checkInFlight: Promise<OusiaUpdateStatus> | undefined
let downloadInFlight: Promise<OusiaUpdateActionResult> | undefined
let checkTimer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<UpdateListener>()

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function writeUpdateLog(
  level: "debug" | "info" | "warn",
  message: string,
  data?: unknown,
) {
  await invoke("report_frontend_log", {
    payload: {
      data,
      level,
      message,
      scope: "update",
    },
  })
}

async function writeUpdateError(
  kind: string,
  message: string,
  error: unknown,
  data?: unknown,
) {
  await invoke("report_frontend_error", {
    payload: {
      data,
      kind,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    },
  })
}

function publish(next: OusiaUpdateStatus) {
  status = next
  for (const listener of listeners) listener(next)
}

async function closeAvailableUpdate() {
  const update = availableUpdate
  availableUpdate = undefined
  downloadedUpdate = undefined
  if (update) await update.close()
}

function updateName(update: Update) {
  const name = update.rawJson.name
  return typeof name === "string" && name.trim()
    ? name.trim()
    : `Pi ${update.version}`
}

async function performCheck(
  source: "startup" | "interval" | "retry",
): Promise<OusiaUpdateStatus> {
  const version = (currentVersion ??= await getVersion())
  if (
    source === "interval" &&
    (status.phase === "available" ||
      status.phase === "downloading" ||
      status.phase === "downloaded")
  ) {
    return status
  }
  if (source === "retry") {
    publish({ phase: "checking", currentVersion: version })
  }
  await writeUpdateLog("info", "Checking for a Pi update", {
    currentVersion: version,
    source,
  })
  try {
    const update = await check({ timeout: UPDATE_TIMEOUT_MS })
    if (!update) {
      await closeAvailableUpdate()
      publish({ phase: "idle", currentVersion: version })
      await writeUpdateLog("info", "Pi is up to date", {
        currentVersion: version,
        source,
      })
      return status
    }

    if (availableUpdate && availableUpdate.rid !== update.rid) {
      await availableUpdate.close()
    }
    availableUpdate = update
    downloadedUpdate = undefined
    publish({
      phase: "available",
      currentVersion: version,
      releaseName: updateName(update),
      version: update.version,
    })
    await writeUpdateLog("info", "A Pi update is available", {
      currentVersion: version,
      source,
      version: update.version,
    })
    return status
  } catch (error) {
    const message = errorMessage(error)
    const targetVersion =
      status.phase === "available" || status.phase === "error"
        ? status.version
        : undefined
    publish(
      source === "retry"
        ? {
            phase: "error",
            currentVersion: version,
            message,
            ...(targetVersion ? { version: targetVersion } : {}),
          }
        : {
            phase: "unavailable",
            currentVersion: version,
            message,
          },
    )
    await writeUpdateError(
      "update_check_failed",
      `Failed to check for a Pi update: ${message}`,
      error,
      { currentVersion: version, source },
    )
    return status
  }
}

function checkForUpdates(source: "startup" | "interval" | "retry") {
  if (checkInFlight) return checkInFlight
  const operation = performCheck(source)
  checkInFlight = operation
  const clear = () => {
    if (checkInFlight === operation) checkInFlight = undefined
  }
  void operation.then(clear, clear)
  return operation
}

function recordDownloadProgress(
  event: DownloadEvent,
  progress: { contentLength?: number; downloadedBytes: number },
) {
  if (event.event === "Started") {
    progress.contentLength = event.data.contentLength
    void writeUpdateLog("info", "Started downloading a Pi update", {
      contentLength: event.data.contentLength,
      version: availableUpdate?.version,
    })
    return
  }
  if (event.event === "Progress") {
    progress.downloadedBytes += event.data.chunkLength
    return
  }
  void writeUpdateLog("info", "Finished downloading a Pi update", {
    contentLength: progress.contentLength,
    downloadedBytes: progress.downloadedBytes,
    version: availableUpdate?.version,
  })
}

async function performDownload(): Promise<OusiaUpdateActionResult> {
  if (!currentVersion) currentVersion = await getVersion()
  if (!availableUpdate) {
    const refreshed = await checkForUpdates("retry")
    if (refreshed.phase !== "available" || !availableUpdate) {
      return {
        ok: false,
        error:
          refreshed.phase === "error"
            ? refreshed.message
            : "No update is currently available.",
      }
    }
  }

  const update = availableUpdate
  publish({
    phase: "downloading",
    currentVersion,
    version: update.version,
  })
  const progress: { contentLength?: number; downloadedBytes: number } = {
    downloadedBytes: 0,
  }
  try {
    await update.download((event) => recordDownloadProgress(event, progress), {
      timeout: DOWNLOAD_TIMEOUT_MS,
    })
    downloadedUpdate = update
    publish({
      phase: "downloaded",
      currentVersion,
      version: update.version,
    })
    return { ok: true }
  } catch (error) {
    const message = errorMessage(error)
    publish({
      phase: "error",
      currentVersion,
      message,
      version: update.version,
    })
    await writeUpdateError(
      "update_download_failed",
      `Failed to download Pi ${update.version}: ${message}`,
      error,
      {
        contentLength: progress.contentLength,
        downloadedBytes: progress.downloadedBytes,
        version: update.version,
      },
    )
    return { ok: false, error: message }
  }
}

export async function getUpdateStatus(): Promise<OusiaUpdateStatus> {
  if (!currentVersion) {
    currentVersion = await getVersion()
    status = { phase: "idle", currentVersion }
    if (!checkTimer) {
      checkTimer = setInterval(
        () => void checkForUpdates("interval"),
        CHECK_INTERVAL_MS,
      )
    }
    return checkForUpdates("startup")
  }
  return status
}

export function downloadUpdate(): Promise<OusiaUpdateActionResult> {
  if (downloadInFlight) return downloadInFlight
  const operation = performDownload()
  downloadInFlight = operation
  const clear = () => {
    if (downloadInFlight === operation) downloadInFlight = undefined
  }
  void operation.then(clear, clear)
  return operation
}

export async function installUpdate(): Promise<OusiaUpdateActionResult> {
  if (!downloadedUpdate || status.phase !== "downloaded") {
    return { ok: false, error: "The update has not finished downloading." }
  }
  const version = downloadedUpdate.version
  try {
    await writeUpdateLog("info", "Installing the downloaded Pi update", {
      version,
    })
    await downloadedUpdate.install()
    await writeUpdateLog("info", "Relaunching Pi after update installation", {
      version,
    })
    await relaunch()
    return { ok: true }
  } catch (error) {
    const message = errorMessage(error)
    publish({
      phase: "error",
      currentVersion: currentVersion ?? "unknown",
      message,
      version,
    })
    await writeUpdateError(
      "update_install_failed",
      `Failed to install Pi ${version}: ${message}`,
      error,
      { version },
    )
    return { ok: false, error: message }
  }
}

export function onUpdateStatus(listener: UpdateListener) {
  listeners.add(listener)
  if (currentVersion) listener(status)
  return () => {
    listeners.delete(listener)
  }
}
