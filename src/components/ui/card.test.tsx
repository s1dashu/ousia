import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Card, CardContent } from "@/components/ui/card"

describe("Card", () => {
  it("uses the semantic Vega card recipe", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardContent>Content</CardContent>
      </Card>
    )

    expect(html).toContain('data-slot="card"')
    expect(html).toContain("rounded-xl")
    expect(html).toContain("bg-card")
    expect(html).toContain("shadow-xs")
    expect(html).toContain("ring-1 ring-foreground/10")
    expect(html).not.toContain("border-[#e5e5e5]")
    expect(html).not.toContain("bg-white")
    expect(html).not.toContain("bg-background")
    expect(html).not.toContain("shadow-none")
  })
})
