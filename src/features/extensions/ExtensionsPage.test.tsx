import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ExtensionsPage } from "@/features/extensions/ExtensionsPage"

describe("ExtensionsPage", () => {
  it("renders the first 20 most-downloaded packages as compact cards", () => {
    const html = renderToStaticMarkup(<ExtensionsPage language="en" />)

    expect(html).toContain(">Extensions &amp; Skills<")
    expect(html).toContain("ousia-stable-scrollbar-gutter")
    expect(html).toContain(">Explore<")
    expect(html).toContain(">Installed<")
    expect(html).toContain('data-slot="tabs-list"')
    expect(html).toContain("max-w-[var(--ousia-chat-content-max-width)]")
    expect(html).toContain(">All types<")
    expect(html.match(/data-slot="card"/g)).toHaveLength(20)
    expect(html).toContain(">@vigolium/piolium<")
    expect(html).toContain(">pi-goal-list-loop-audit<")
    expect(html).not.toContain(">@narumitw/pi-goal<")
    expect(html).toContain(">478.7K<")
    expect(html).toContain('title="478,728/mo"')
    expect(html).toContain(">Install</button>")
    expect(html).toContain('data-variant="secondary" data-size="xs"')
    expect(html.indexOf(">478.7K<")).toBeLessThan(
      html.indexOf(">Install</button>")
    )
    expect(html).toContain(">j3ssie<")
    expect(html).not.toContain(">By j3ssie<")
    expect(html).toMatch(/j3ssie<\/span><div[^>]*><span[^>]*>Extension</)
    expect(html).toContain(">Extension<")
    expect(html).not.toContain("Published Aug")
  })

  it("links package names to GitHub and link icons to pi.dev", () => {
    const html = renderToStaticMarkup(<ExtensionsPage language="en" />)

    expect(html).toContain(
      'href="https://github.com/vigolium/piolium" target="_blank"'
    )
    expect(html).toContain(
      'href="https://pi.dev/packages/@vigolium/piolium" target="_blank"'
    )
    expect(html).toContain('aria-label="Open @vigolium/piolium on GitHub"')
    expect(html).toContain(
      'aria-label="View @vigolium/piolium details on pi.dev"'
    )
  })

  it("renders five accessible pages and localized Chinese copy", () => {
    const englishHtml = renderToStaticMarkup(<ExtensionsPage language="en" />)
    const chineseHtml = renderToStaticMarkup(<ExtensionsPage language="zh" />)

    expect(englishHtml.match(/aria-label="Page \d of 5"/g)).toHaveLength(5)
    expect(englishHtml).toContain('aria-current="page"')
    expect(englishHtml).toContain('aria-label="Previous page"')
    expect(englishHtml).toContain('aria-label="Next page"')
    expect(chineseHtml).toContain(">扩展与技能<")
    expect(chineseHtml).toContain(">全部类型<")
  })
})
