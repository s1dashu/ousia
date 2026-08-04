import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8")

describe("window drag region boundaries", () => {
  it("keeps every native no-drag rule scoped to a drag region", () => {
    const noDragSelectors = Array.from(
      css.matchAll(/([^{}]+)\{([^{}]*)\}/g),
      (match) => ({ body: match[2], selector: match[1].trim() })
    )
      .filter(({ body }) =>
        body.includes("-webkit-app-region: no-drag")
      )
      .map(({ selector }) => selector)

    expect(noDragSelectors.length).toBeGreaterThan(0)
    for (const selector of noDragSelectors) {
      expect(selector).toContain(".window-drag")
    }
  })
})
