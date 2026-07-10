import { describe, expect, it } from "vitest"

import {
  defineAgentPromptManifest,
  renderAgentPrompt,
} from "../src/index.js"

describe("Agent prompt manifest", () => {
  it("composes ordered provider-neutral prompt sections", () => {
    const manifest = defineAgentPromptManifest({
      sections: [
        { id: "miki.product", content: "You are Miki." },
        { id: "miki.canvas", content: "Use the canvas for artifacts." },
      ],
    })

    expect(renderAgentPrompt(manifest)).toBe(
      "You are Miki.\n\nUse the canvas for artifacts."
    )
    expect(Object.isFrozen(manifest.sections)).toBe(true)
  })

  it("rejects duplicate, malformed, or empty sections", () => {
    expect(() =>
      defineAgentPromptManifest({
        sections: [
          { id: "miki.product", content: "one" },
          { id: "miki.product", content: "two" },
        ],
      })
    ).toThrow("Duplicate Agent prompt section: miki.product")
    expect(() =>
      defineAgentPromptManifest({
        sections: [{ id: "Miki", content: "text" }],
      })
    ).toThrow("lowercase dot- or hyphen-separated")
    expect(() =>
      defineAgentPromptManifest({
        sections: [{ id: "miki.empty", content: " " }],
      })
    ).toThrow("non-empty, trimmed string")
    expect(() =>
      defineAgentPromptManifest({
        sections: new Array(1),
      })
    ).toThrow("sections[0] must be an object")
  })
})
