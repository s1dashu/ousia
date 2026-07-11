import type { MessageBoxOptions } from "electron"

import type { OusiaUpdateStatus } from "./chat-types.js"

export function updateCheckDialogOptions(
  status: OusiaUpdateStatus
): MessageBoxOptions {
  if (status.phase === "available") {
    return {
      type: "info",
      title: "Update Available",
      message: `${status.releaseName} is available.`,
      detail: "Use the Update button in the sidebar to download it.",
    }
  }
  if (status.phase === "downloading") {
    return {
      type: "info",
      title: "Downloading Update",
      message: `Ousia ${status.version} is downloading.`,
    }
  }
  if (status.phase === "downloaded") {
    return {
      type: "info",
      title: "Update Ready",
      message: `Ousia ${status.version} is ready to install.`,
      detail: "Use the Restart button in the sidebar to finish the update.",
    }
  }
  if (status.phase === "error") {
    return {
      type: "error",
      title: "Unable to Check for Updates",
      message: "Ousia could not check for updates.",
      detail: status.message,
    }
  }
  if (status.phase === "disabled") {
    return {
      type: "info",
      title: "Updates Unavailable",
      message: status.reason,
    }
  }
  return {
    type: "info",
    title: "Ousia Is Up to Date",
    message: `Ousia ${status.currentVersion} is the latest version.`,
  }
}
