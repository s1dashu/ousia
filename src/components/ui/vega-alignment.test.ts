import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function readSource(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8")
}

describe("Vega component alignment", () => {
  it("keeps standard scroll containers free of Ousia product scrollbars", () => {
    for (const relativePath of [
      "src/components/ui/dropdown-menu.tsx",
      "src/components/ui/select.tsx",
      "src/components/ui/table.tsx",
    ]) {
      expect(readSource(relativePath)).not.toContain("ousia-hover-scrollbar")
    }
  })

  it("does not override Vega menu geometry in chat compositions", () => {
    const chatArea = readSource("src/features/chat/ChatArea.tsx")
    const chatHeader = readSource("src/features/chat/ChatHeader.tsx")

    expect(chatArea).toContain('className="w-72"')
    expect(chatArea).toContain(
      'className="max-h-[min(var(--available-height),640px)] w-72"'
    )
    expect(chatArea).not.toContain(
      'className="h-10 rounded-md px-2 hover:bg-neutral-100 focus:bg-neutral-100"'
    )
    expect(chatArea).not.toContain(
      'className="ousia-hover-scrollbar w-72 rounded-xl p-2"'
    )
    expect(chatHeader).not.toContain("hover:bg-neutral-100")
    expect(chatHeader).not.toContain("text-neutral-500")
  })

  it("retains the business separators while using the standard recipe", () => {
    const chatArea = readSource("src/features/chat/ChatArea.tsx")
    const separators = chatArea.match(/<DropdownMenuSeparator \/>/g) ?? []

    expect(separators).toHaveLength(2)
  })
})
