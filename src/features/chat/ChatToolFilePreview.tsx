import {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"

import type { getMessages } from "@/app/i18n"
import { useTheme, type ResolvedTheme } from "@/components/theme-provider"
import type { OusiaChatToolFilePreview } from "@/electron/chat-types"

const wrapFillUnsafeCSS = `
  [data-overflow="wrap"] {
    --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr);
    padding-block-end: 6px;
  }

  [data-overflow="wrap"] [data-code],
  [data-overflow="wrap"] [data-content],
  [data-overflow="wrap"] [data-line],
  [data-overflow="wrap"] [data-no-newline],
  [data-overflow="wrap"] [data-content-buffer] {
    inline-size: 100%;
    min-inline-size: 0;
  }

  [data-overflow="wrap"] [data-code] {
    overflow: clip;
    scrollbar-gutter: auto;
  }

  [data-no-newline] {
    display: none;
  }
`

const baseDiffOptions = {
  diffStyle: "unified",
  overflow: "wrap",
  unsafeCSS: wrapFillUnsafeCSS,
} as const

const baseFileOptions = {
  overflow: "wrap",
  unsafeCSS: wrapFillUnsafeCSS,
} as const

const diffOptionsByTheme = {
  dark: {
    ...baseDiffOptions,
    themeType: "dark",
  },
  light: {
    ...baseDiffOptions,
    themeType: "light",
  },
} as const

const fileOptionsByTheme = {
  dark: {
    ...baseFileOptions,
    themeType: "dark",
  },
  light: {
    ...baseFileOptions,
    themeType: "light",
  },
} as const

const previewFrameStyle = {
  border: "1px solid color-mix(in oklch, var(--foreground) 10%, transparent)",
  borderRadius: "8px",
  display: "block",
  maxHeight: "48dvh",
  overflowX: "hidden",
  overflowY: "auto",
  scrollbarGutter: "auto",
} satisfies CSSProperties

const pierreSurfaceStyle = {
  display: "block",
} satisfies CSSProperties

const LazyPierreDiffPreview = lazy(async () => {
  const [{ File, FileDiff, PatchDiff }, { parseDiffFromFile }] = await Promise.all([
    import("@pierre/diffs/react"),
    import("@pierre/diffs"),
  ])

  type ParsedGeneratedDiff = ReturnType<typeof parseDiffFromFile>

  function removeNoNewlineMetadata(
    fileDiff: ParsedGeneratedDiff
  ): ParsedGeneratedDiff {
    return {
      ...fileDiff,
      hunks: fileDiff.hunks.map((hunk) => ({
        ...hunk,
        noEOFCRAdditions: false,
        noEOFCRDeletions: false,
      })),
    }
  }

  function stripNoNewlinePatchMetadata(patch: string) {
    return patch.replace(
      /(?:\r?\n)?\\ No newline at end of file(?=\r?\n|$)/g,
      ""
    )
  }

  function GeneratedDiffPreview({
    preview,
    themeType,
  }: {
    preview: Extract<OusiaChatToolFilePreview, { kind: "diff" }>
    themeType: ResolvedTheme
  }) {
    const fileDiff = useMemo(() => {
      const oldFile = {
        cacheKey: `${preview.path}:old:${preview.oldContent.length}`,
        contents: preview.oldContent,
        name: preview.path,
      }
      const newFile = {
        cacheKey: `${preview.path}:new:${preview.newContent.length}`,
        contents: preview.newContent,
        name: preview.path,
      }
      const parsedDiff = parseDiffFromFile(oldFile, newFile)
      return removeNoNewlineMetadata({
        ...parsedDiff,
        name: preview.path,
        prevName:
          parsedDiff.prevName && parsedDiff.prevName !== parsedDiff.name
            ? preview.path
            : undefined,
      })
    }, [preview.newContent, preview.oldContent, preview.path])

    return (
      <FileDiff
        disableWorkerPool
        fileDiff={fileDiff}
        options={diffOptionsByTheme[themeType]}
        style={pierreSurfaceStyle}
      />
    )
  }

  function PatchDiffPreview({
    preview,
    themeType,
  }: {
    preview: Extract<OusiaChatToolFilePreview, { kind: "patch" }>
    themeType: ResolvedTheme
  }) {
    const patch = useMemo(
      () => stripNoNewlinePatchMetadata(preview.patch),
      [preview.patch]
    )

    return (
      <PatchDiff
        disableWorkerPool
        options={diffOptionsByTheme[themeType]}
        patch={patch}
        style={pierreSurfaceStyle}
      />
    )
  }

  return {
    default: function PierreDiffPreview({
      preview,
      themeType,
    }: {
      preview: OusiaChatToolFilePreview
      themeType: ResolvedTheme
    }) {
      if (preview.kind === "diff") {
        return <GeneratedDiffPreview preview={preview} themeType={themeType} />
      }

      if (preview.kind === "patch") {
        return <PatchDiffPreview preview={preview} themeType={themeType} />
      }

      if (preview.kind === "file") {
        return (
          <File
            disableWorkerPool
            file={{
              cacheKey: `${preview.path}:file:${preview.content.length}`,
              contents: preview.content,
              name: preview.path,
            }}
            options={fileOptionsByTheme[themeType]}
            style={pierreSurfaceStyle}
          />
        )
      }

      return (
        <pre className="m-0 whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-4 text-[var(--ousia-tool-warning-strong)]">
          {preview.message}
        </pre>
      )
    },
  }
})

export function ToolFilePreviewView({
  preview,
  t,
}: {
  preview: OusiaChatToolFilePreview
  t: ReturnType<typeof getMessages>
}) {
  const { resolvedTheme } = useTheme()
  const frameRef = useRef<HTMLDivElement>(null)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)

  useLayoutEffect(() => {
    if (!isFollowingLatest) {
      return
    }
    const node = frameRef.current
    if (!node) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [isFollowingLatest, preview])

  if (preview.kind === "error") {
    return (
      <div className="mt-1.5 rounded-md border border-[var(--ousia-tool-warning)] bg-[var(--ousia-tool-warning-bg)]">
        <pre className="m-0 whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] leading-4 text-[var(--ousia-tool-warning-strong)]">
          {preview.message}
        </pre>
      </div>
    )
  }

  return (
    <div
      ref={frameRef}
      className="ousia-hover-scrollbar mt-1.5"
      onScroll={(event) => {
        const node = event.currentTarget
        setIsFollowingLatest(
          node.scrollHeight - node.scrollTop - node.clientHeight < 8
        )
      }}
      style={previewFrameStyle}
    >
      <Suspense
        fallback={
          <div className="px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
            {t.chat.toolPayloadLoading}
          </div>
        }
      >
        <LazyPierreDiffPreview preview={preview} themeType={resolvedTheme} />
      </Suspense>
    </div>
  )
}
