import { describe, expect, it } from "vitest"

import { getNativeMessages } from "./native-i18n.js"

describe("native i18n", () => {
  it("provides Chinese labels for the native application menu", () => {
    expect(getNativeMessages("zh").menu).toMatchObject({
      about: "关于 Ousia",
      checkForUpdates: "检查更新…",
      edit: "编辑",
      view: "显示",
      window: "窗口",
      quit: "退出 Ousia",
    })
  })

  it("keeps the English native application menu available", () => {
    expect(getNativeMessages("en").menu).toMatchObject({
      about: "About Ousia",
      checkForUpdates: "Check for Updates…",
      edit: "Edit",
      view: "View",
      window: "Window",
      quit: "Quit Ousia",
    })
  })
})
