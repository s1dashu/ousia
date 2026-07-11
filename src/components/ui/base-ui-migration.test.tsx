import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/features/settings/SettingsSwitch"

describe("Base UI migration adapters", () => {
  it("keeps Button's Radix-era asChild API without adding a wrapper element", () => {
    const html = renderToStaticMarkup(
      <Button asChild>
        <a href="/settings">Settings</a>
      </Button>
    )

    expect(html).toContain('<a href="/settings"')
    expect(html).toContain('data-slot="button"')
    expect(html).not.toContain("<button")
    expect(html).not.toContain('type="button"')
  })

  it("composes a menu trigger through the preserved asChild API", () => {
    const html = renderToStaticMarkup(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Open</Button>
        </DropdownMenuTrigger>
      </DropdownMenu>
    )

    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('data-slot="dropdown-menu-trigger"')
    expect(html).toContain('aria-haspopup="menu"')
  })

  it("renders Select and Switch with Base UI state attributes", () => {
    const selectHtml = renderToStaticMarkup(
      <Select items={[{ label: "Pi", value: "pi" }]} value="pi">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectItem value="pi">Pi</SelectItem>
      </Select>
    )
    const switchHtml = renderToStaticMarkup(<Switch checked={false} />)

    expect(selectHtml).toContain('data-slot="select-trigger"')
    expect(selectHtml).toContain("Pi")
    expect(switchHtml).toContain('data-slot="settings-switch"')
    expect(switchHtml).toContain("data-unchecked")
    expect(switchHtml).not.toContain("data-state")
  })
})
