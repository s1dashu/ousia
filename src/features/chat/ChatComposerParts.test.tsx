import { readFileSync } from "node:fs"
import path from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Textarea } from "@/components/ui/textarea"
import {
  CHAT_COMPOSER_INPUT_CLASS,
  CHAT_COMPOSER_SHELL_CLASS,
  CHAT_QUEUE_OVERLAY_CLASS,
} from "@/features/chat/ChatComposerParts"

const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8")

describe("Chat composer input", () => {
  it("fully neutralizes the default field surface", () => {
    const html = renderToStaticMarkup(
      <Textarea className={CHAT_COMPOSER_INPUT_CLASS} />,
    )

    expect(html).toContain("resize-none")
    expect(html).toContain("border-0")
    expect(html).toContain("shadow-none")
    expect(html).toContain("dark:bg-transparent")
    expect(html).not.toContain("shadow-xs")
    expect(html).not.toContain("rounded-md")
  })

  it("does not place an opaque padding strip above the composer", () => {
    expect(CHAT_COMPOSER_SHELL_CLASS).toContain("pb-4")
    expect(CHAT_COMPOSER_SHELL_CLASS).not.toMatch(/(?:^|\s)pt-/)
  })

  it("keeps queue growth out of the conversation layout", () => {
    expect(CHAT_QUEUE_OVERLAY_CLASS).toMatch(/(?:^|\s)absolute(?:\s|$)/)
    expect(CHAT_QUEUE_OVERLAY_CLASS).toContain("max-h-")
    expect(CHAT_QUEUE_OVERLAY_CLASS).toContain("overflow-y-auto")
  })

  it("keeps the dark composer tinted and strongly elevated", () => {
    const darkMainPanel = css.match(
      /\.dark \.ousia-main-panel \{(?<declarations>[^}]*)\}/,
    )?.groups?.declarations

    expect(darkMainPanel).toContain(
      "--ousia-composer-surface: color-mix(\n    in srgb,\n    var(--ousia-app-card) 97%,\n    white",
    )
    expect(darkMainPanel).toContain("0 20px 44px -18px")
    expect(darkMainPanel).toContain("0 24px 52px -18px")
  })
})
