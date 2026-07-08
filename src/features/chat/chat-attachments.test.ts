import { Buffer } from "node:buffer"

import { afterEach, describe, expect, it, vi } from "vitest"

import { getMessages } from "@/app/i18n"

import {
  chatAttachmentFromFile,
  filesFromDataTransfer,
  normalizePastedMessageText,
} from "./chat-attachments"

const t = getMessages("en")

class FileReaderStub {
  error: Error | null = null
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null
  result: string | ArrayBuffer | null = null

  readAsDataURL(file: File) {
    void file.arrayBuffer().then(
      (buffer) => {
        const mediaType = file.type || "application/octet-stream"
        this.result = `data:${mediaType};base64,${Buffer.from(buffer).toString(
          "base64"
        )}`
        this.onload?.({} as ProgressEvent<FileReader>)
      },
      (error: Error) => {
        this.error = error
        this.onerror?.({} as ProgressEvent<FileReader>)
      }
    )
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("normalizePastedMessageText", () => {
  it("trims copied single messages with surrounding blank lines", () => {
    expect(normalizePastedMessageText("\n\nhello\n\n")).toBe("hello")
  })

  it("preserves intentional leading whitespace", () => {
    expect(normalizePastedMessageText("\n  code\n")).toBe("\n  code\n")
  })

  it("preserves all-blank clipboard text", () => {
    expect(normalizePastedMessageText("\n\n")).toBe("\n\n")
  })
})

describe("filesFromDataTransfer", () => {
  it("uses the native files list when present", () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" })

    expect(
      filesFromDataTransfer({ files: [file] } as unknown as DataTransfer)
    ).toEqual([file])
  })

  it("falls back to file items", () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" })

    expect(
      filesFromDataTransfer({
        files: [],
        items: [
          { getAsFile: () => file, kind: "file" },
          { getAsFile: () => null, kind: "file" },
          { getAsFile: () => file, kind: "string" },
        ],
      } as unknown as DataTransfer)
    ).toEqual([file])
  })
})

describe("chatAttachmentFromFile", () => {
  it("creates image attachments with base64 data", async () => {
    vi.stubGlobal("FileReader", FileReaderStub)

    await expect(
      chatAttachmentFromFile(new File(["image-bytes"], "screen.PNG"), t)
    ).resolves.toMatchObject({
      dataBase64: Buffer.from("image-bytes").toString("base64"),
      kind: "image",
      mediaType: "image/png",
      name: "screen.PNG",
    })
  })

  it("creates text attachments for text-like file names", async () => {
    const attachment = await chatAttachmentFromFile(
      new File(["# Notes"], "notes.md"),
      t
    )

    expect(attachment).toMatchObject({
      kind: "text",
      mediaType: "text/plain",
      name: "notes.md",
      size: 7,
      text: "# Notes",
    })
    expect(attachment.id).toMatch(/^attachment-/)
  })

  it("creates generic file attachments for binary files", async () => {
    await expect(
      chatAttachmentFromFile(new File([new Uint8Array([1, 2])], "archive.bin"), t)
    ).resolves.toMatchObject({
      kind: "file",
      mediaType: "application/octet-stream",
      name: "archive.bin",
      size: 2,
    })
  })

  it("uses file name media type fallbacks for JSON text", async () => {
    await expect(
      chatAttachmentFromFile(new File(['{"ok":true}'], "data.json"), t)
    ).resolves.toMatchObject({
      kind: "text",
      mediaType: "application/json",
      name: "data.json",
      text: '{"ok":true}',
    })
  })
})
