import { describe, expect, it } from "vitest"

import {
  TOOLTIP_CONTENT_LAYOUT_CLASS_NAME,
  TOOLTIP_TEXT_LAYOUT_CLASS_NAME,
} from "@/components/ui/tooltip"

describe("TooltipContent layout", () => {
  it("allows long content to wrap within the configured maximum width", () => {
    expect(TOOLTIP_CONTENT_LAYOUT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["w-fit", "max-w-xs"])
    )
    expect(TOOLTIP_TEXT_LAYOUT_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "break-words", "whitespace-pre-wrap"])
    )
    expect(TOOLTIP_TEXT_LAYOUT_CLASS_NAME).not.toContain("whitespace-nowrap")
  })
})
