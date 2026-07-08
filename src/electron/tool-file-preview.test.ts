import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  createHistoricalToolInputFilePreview,
  createToolFilePreview,
  createToolResultFilePreview,
} from "./tool-file-preview"

describe("tool file previews", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = join(tmpdir(), `ousia-tool-preview-${Date.now()}`)
    mkdirSync(projectRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(projectRoot, { force: true, recursive: true })
  })

  function writeProjectFile(path: string, content: string) {
    const filePath = join(projectRoot, path)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, "utf8")
  }

  it("creates write previews from structured args", () => {
    expect(
      createToolFilePreview({
        args: { content: "export const answer = 42\n", path: "src/value.ts" },
        projectPath: projectRoot,
        toolName: "write",
      })
    ).toEqual({
      kind: "diff",
      path: "src/value.ts",
      oldContent: "",
      newContent: "export const answer = 42\n",
      source: "input",
    })
  })

  it("returns undefined for unknown tools and incomplete write args", () => {
    expect(
      createToolFilePreview({
        args: { content: "hello", path: "note.txt" },
        projectPath: projectRoot,
        toolName: "read",
      })
    ).toBeUndefined()
    expect(
      createToolFilePreview({
        args: { content: "hello" },
        projectPath: projectRoot,
        toolName: "write",
      })
    ).toBeUndefined()
    expect(
      createHistoricalToolInputFilePreview({
        args: { content: "hello", path: "note.txt" },
        toolName: "edit",
      })
    ).toBeUndefined()
  })

  it("returns undefined for malformed edit args", () => {
    expect(
      createToolFilePreview({
        args: "not-json",
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toBeUndefined()
    expect(
      createToolFilePreview({
        args: { newText: "new", oldText: "old" },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toBeUndefined()
  })

  it("creates write previews from partial streaming JSON", () => {
    expect(
      createToolFilePreview({
        args: '{"path":"src/value.ts","content":"line one\\nline two',
        projectPath: projectRoot,
        toolName: "write",
      })
    ).toEqual({
      kind: "diff",
      path: "src/value.ts",
      oldContent: "",
      newContent: "line one\nline two",
      source: "input",
    })
  })

  it("creates historical write previews", () => {
    expect(
      createHistoricalToolInputFilePreview({
        args: JSON.stringify({
          content: "hello",
          file_path: "README.md",
        }),
        toolName: "write",
      })
    ).toEqual({
      kind: "diff",
      path: "README.md",
      oldContent: "",
      newContent: "hello",
      source: "input",
    })
  })

  it("creates edit previews from exact replacements", () => {
    writeProjectFile("note.txt", "alpha\nbeta\ngamma\n")

    expect(
      createToolFilePreview({
        args: {
          newText: "BETA",
          oldText: "beta",
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toEqual({
      kind: "diff",
      path: "note.txt",
      oldContent: "alpha\nbeta\ngamma\n",
      newContent: "alpha\nBETA\ngamma\n",
      source: "input",
    })
  })

  it("accepts filePath aliases for edit targets", () => {
    writeProjectFile("note.txt", "alpha\n")

    expect(
      createToolFilePreview({
        args: {
          filePath: "note.txt",
          newText: "ALPHA",
          oldText: "alpha",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "diff",
      path: "note.txt",
      newContent: "ALPHA\n",
    })
  })

  it("creates edit previews from multiple replacements", () => {
    writeProjectFile("note.txt", "alpha\nbeta\ngamma\n")

    expect(
      createToolFilePreview({
        args: {
          edits: JSON.stringify([
            { newText: "ALPHA", oldText: "alpha" },
            { newText: "GAMMA", oldText: "gamma" },
          ]),
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "diff",
      newContent: "ALPHA\nbeta\nGAMMA\n",
      oldContent: "alpha\nbeta\ngamma\n",
    })
  })

  it("uses fuzzy normalized text only when exact text is unavailable", () => {
    writeProjectFile("note.txt", "const label = “hello”\n")

    expect(
      createToolFilePreview({
        args: {
          newText: 'const label = "hi"',
          oldText: 'const label = "hello"',
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "diff",
      newContent: 'const label = "hi"\n',
      oldContent: 'const label = "hello"\n',
    })
  })

  it("normalizes CRLF files before generating edit diffs", () => {
    writeProjectFile("note.txt", "alpha\r\nbeta\r\ngamma\r\n")

    expect(
      createToolFilePreview({
        args: {
          edits: [{ newText: "BETA", oldText: "beta" }],
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "diff",
      oldContent: "alpha\nbeta\ngamma\n",
      newContent: "alpha\nBETA\ngamma\n",
    })
  })

  it("returns explicit edit errors for duplicate matches", () => {
    writeProjectFile("note.txt", "same\nsame\n")

    expect(
      createToolFilePreview({
        args: {
          newText: "changed",
          oldText: "same",
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "error",
      message:
        "Found 2 occurrences of the text in note.txt. The text must be unique. Please provide more context to make it unique.",
      path: "note.txt",
      source: "input",
    })
  })

  it("returns explicit edit errors for empty old text", () => {
    writeProjectFile("note.txt", "same\n")

    expect(
      createToolFilePreview({
        args: {
          newText: "changed",
          oldText: "",
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "error",
      message: "oldText must not be empty in note.txt.",
    })
  })

  it("returns explicit edit errors when the old text is missing", () => {
    writeProjectFile("note.txt", "same\n")

    expect(
      createToolFilePreview({
        args: {
          newText: "changed",
          oldText: "missing",
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "error",
      message:
        "Could not find the exact text in note.txt. The old text must match exactly including all whitespace and newlines.",
    })
  })

  it("returns explicit edit errors for overlapping edits", () => {
    writeProjectFile("note.txt", "abcdef\n")

    expect(
      createToolFilePreview({
        args: {
          edits: [
            { newText: "ABC", oldText: "abc" },
            { newText: "BCD", oldText: "bcd" },
          ],
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "error",
      message:
        "edits[0] and edits[1] overlap in note.txt. Merge them into one edit or target disjoint regions.",
    })
  })

  it("returns explicit edit errors for no-op replacements", () => {
    writeProjectFile("note.txt", "same\n")

    expect(
      createToolFilePreview({
        args: {
          newText: "same",
          oldText: "same",
          path: "note.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "error",
      message:
        "No changes made to note.txt. The replacement produced identical content.",
    })
  })

  it("returns explicit edit errors for paths outside the project", () => {
    expect(
      createToolFilePreview({
        args: {
          newText: "changed",
          oldText: "same",
          path: "../outside.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "error",
      message: "项目文件路径必须位于项目目录内。",
      path: "../outside.txt",
      source: "input",
    })
  })

  it("returns explicit edit errors when the preview target is a directory", () => {
    mkdirSync(join(projectRoot, "folder"), { recursive: true })

    expect(
      createToolFilePreview({
        args: {
          newText: "changed",
          oldText: "same",
          path: "folder",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "error",
      message: "Preview target is not a file.",
      path: "folder",
      source: "input",
    })
  })

  it("returns explicit edit errors when the preview target is too large", () => {
    writeProjectFile("large.txt", "x".repeat(1024 * 1024 + 1))

    expect(
      createToolFilePreview({
        args: {
          newText: "changed",
          oldText: "x",
          path: "large.txt",
        },
        projectPath: projectRoot,
        toolName: "edit",
      })
    ).toMatchObject({
      kind: "error",
      message: "Preview target is too large.",
      path: "large.txt",
      source: "input",
    })
  })

  it("creates result patch previews for edit tool results", () => {
    expect(
      createToolResultFilePreview({
        result: { details: { patch: "@@ -1 +1 @@\n-old\n+new" } },
        toolName: "edit",
      })
    ).toEqual({
      kind: "patch",
      patch: "@@ -1 +1 @@\n-old\n+new",
      source: "result",
    })
  })

  it("returns undefined for non-edit or patchless result previews", () => {
    expect(
      createToolResultFilePreview({
        result: { details: { patch: "@@ patch" } },
        toolName: "write",
      })
    ).toBeUndefined()
    expect(
      createToolResultFilePreview({
        result: { details: {} },
        toolName: "edit",
      })
    ).toBeUndefined()
  })
})
