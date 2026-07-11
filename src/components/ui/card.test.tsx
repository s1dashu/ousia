import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Card, CardContent } from "@/components/ui/card"

describe("Card", () => {
  it("uses the approved white Nova surface instead of the warm card token", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardContent>Content</CardContent>
      </Card>
    )

    expect(html).toContain('data-slot="card"')
    expect(html).toContain("rounded-[12px]")
    expect(html).toContain("border-[#e5e5e5]")
    expect(html).toContain("bg-white")
    expect(html).toContain("shadow-none")
    expect(html).not.toContain("bg-card")
    expect(html).not.toContain("bg-background")
    expect(html).not.toContain("bg-muted")
  })
})
