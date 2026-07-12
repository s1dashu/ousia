import type { MessageBoxOptions } from "electron"

import type { OusiaLanguage, OusiaUpdateStatus } from "./chat-types.js"
import { getNativeMessages } from "./native-i18n.js"

export function updateCheckDialogOptions(
  status: OusiaUpdateStatus,
  language: OusiaLanguage
): MessageBoxOptions {
  const t = getNativeMessages(language).update
  if (status.phase === "available") {
    return {
      type: "info",
      title: t.availableTitle,
      message: t.availableMessage(status.releaseName),
      detail: t.availableDetail,
    }
  }
  if (status.phase === "downloading") {
    return {
      type: "info",
      title: t.downloadingTitle,
      message: t.downloadingMessage(status.version),
    }
  }
  if (status.phase === "downloaded") {
    return {
      type: "info",
      title: t.readyTitle,
      message: t.readyMessage(status.version),
      detail: t.readyDetail,
    }
  }
  if (status.phase === "error") {
    return {
      type: "error",
      title: t.errorTitle,
      message: t.errorMessage,
      detail: status.message,
    }
  }
  if (status.phase === "disabled") {
    return {
      type: "info",
      title: t.unavailableTitle,
      message: status.reason,
    }
  }
  return {
    type: "info",
    title: t.upToDateTitle,
    message: t.upToDateMessage(status.currentVersion),
  }
}
