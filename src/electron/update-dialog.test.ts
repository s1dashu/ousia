import { describe, expect, it } from "vitest"

import { updateCheckDialogOptions } from "./update-dialog.js"

describe("updateCheckDialogOptions", () => {
  it("describes available updates and where to download them", () => {
    expect(
      updateCheckDialogOptions({
        phase: "available",
        currentVersion: "0.1.23",
        version: "0.1.24",
        releaseName: "Ousia 0.1.24",
      })
    ).toMatchObject({
      title: "Update Available",
      message: "Ousia 0.1.24 is available.",
      detail: "Use the Update button in the sidebar to download it.",
    })
  })

  it("reports an up-to-date installation", () => {
    expect(
      updateCheckDialogOptions({ phase: "idle", currentVersion: "0.1.23" })
    ).toMatchObject({
      title: "Ousia Is Up to Date",
      message: "Ousia 0.1.23 is the latest version.",
    })
  })

  it("keeps update failures visible", () => {
    expect(
      updateCheckDialogOptions({
        phase: "error",
        currentVersion: "0.1.23",
        message: "fetch failed",
      })
    ).toMatchObject({
      type: "error",
      title: "Unable to Check for Updates",
      detail: "fetch failed",
    })
  })
})
