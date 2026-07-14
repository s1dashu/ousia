import { describe, expect, it } from "vitest"

import {
  createDefaultOusiaAppState,
  defaultOusiaAppSettings,
  normalizeOusiaAppSettings,
  OUSIA_DEFAULT_WORK_DIR,
  OUSIA_LEGACY_DEFAULT_WORK_DIR,
  PI_GUI_DEFAULT_WORK_DIR,
  PI_GUI_PREVIOUS_DEFAULT_WORK_DIR,
} from "./chat-types"

describe("Pi GUI default working-directory migration", () => {
  it.each([
    PI_GUI_PREVIOUS_DEFAULT_WORK_DIR,
    OUSIA_DEFAULT_WORK_DIR,
    OUSIA_LEGACY_DEFAULT_WORK_DIR,
  ])(
    "migrates the obsolete default directory %s",
    (obsoleteDirectory) => {
      const settings = normalizeOusiaAppSettings({
        ...defaultOusiaAppSettings,
        defaultSessionDir: obsoleteDirectory,
        defaultProjectCreationDir: obsoleteDirectory,
      })

      expect(settings.defaultSessionDir).toBe(PI_GUI_DEFAULT_WORK_DIR)
      expect(settings.defaultProjectCreationDir).toBe(PI_GUI_DEFAULT_WORK_DIR)
    },
  )

  it("preserves an explicitly configured custom directory", () => {
    const settings = normalizeOusiaAppSettings({
      ...defaultOusiaAppSettings,
      defaultSessionDir: "~/code",
      defaultProjectCreationDir: "~/projects",
    })

    expect(settings.defaultSessionDir).toBe("~/code")
    expect(settings.defaultProjectCreationDir).toBe("~/projects")
  })

  it("snapshots the working directory for the initial session", () => {
    const state = createDefaultOusiaAppState()

    expect(state.sessions[0]?.workingDirectory).toBe(PI_GUI_DEFAULT_WORK_DIR)
  })
})

describe("Pi GUI send-during-run defaults", () => {
  it("queues messages when no preference has been persisted", () => {
    expect(defaultOusiaAppSettings.sendDuringRunMode).toBe("queue")
    expect(normalizeOusiaAppSettings().sendDuringRunMode).toBe("queue")
  })

  it("preserves an explicit steer preference", () => {
    expect(
      normalizeOusiaAppSettings({ sendDuringRunMode: "steer" })
        .sendDuringRunMode,
    ).toBe("steer")
  })
})
