import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Textarea } from "@/components/ui/textarea"
import {
  CHAT_COMPOSER_INPUT_CLASS,
  CHAT_COMPOSER_SHELL_CLASS,
} from "@/features/chat/ChatComposerParts"

describe("Chat composer input", () => {
  it("fully neutralizes the default Vega field surface", () => {
    const html = renderToStaticMarkup(
      <Textarea className={CHAT_COMPOSER_INPUT_CLASS} />
    )

    expect(html).toContain("resize-none")
    expect(html).toContain("min-h-10")
    expect(html).toContain("border-0")
    expect(html).toContain("shadow-none")
    expect(html).toContain("dark:bg-transparent")
    expect(html).not.toContain("shadow-xs")
    expect(html).not.toContain("rounded-md")
    expect(html).not.toContain("min-h-12")
  })

  it("keeps the Composer outside the message scroll region", () => {
    expect(CHAT_COMPOSER_SHELL_CLASS).toContain("pb-4")
    expect(CHAT_COMPOSER_SHELL_CLASS).toContain("bg-transparent")
    expect(CHAT_COMPOSER_SHELL_CLASS).toContain("shrink-0")
    expect(CHAT_COMPOSER_SHELL_CLASS).not.toContain("absolute")
    expect(CHAT_COMPOSER_SHELL_CLASS).not.toMatch(/(?:^|\s)pt-/)
  })
})
