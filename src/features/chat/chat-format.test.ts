import { describe, expect, it } from "vitest"

import { formatBytes } from "./chat-format"

describe("formatBytes", () => {
  it("formats invalid and zero sizes as zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(Number.NaN)).toBe("0 B")
  })

  it("formats byte, KB, MB, and GB sizes", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(10 * 1024)).toBe("10 KB")
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB")
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB")
  })
})
