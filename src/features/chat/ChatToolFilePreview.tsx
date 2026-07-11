import {
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type WheelEvent,
} from "react"

import type { getMessages } from "@/app/i18n"
import { FolderOpen, SendArrowDown } from "@/components/icons/huge-icons"
import { useTheme, type ResolvedTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { OusiaChatToolFilePreview } from "@/electron/chat-types"

const SCROLL_TO_LATEST_THRESHOLD = 24

const wrapFillUnsafeCSS = `
  [data-overflow="wrap"] {
    --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr);
    padding-block-end: 0;
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
    padding-block-end: 0;
    scrollbar-gutter: auto;
  }

  [data-diffs-header] {
    background-color: var(--ousia-diff-card-bg);
  }

  [data-diffs-header][data-sticky] {
    background-color: var(--ousia-diff-card-bg);
    z-index: 6;
  }

  [data-background] [data-line-type="change-addition"]:where([data-gutter-buffer], [data-column-number]) {
    --diffs-bg-addition-number-override: color-mix(in oklch, var(--diffs-addition-base) 32%, var(--diffs-bg));
    --diffs-fg-number-addition-override: color-mix(in oklch, var(--diffs-addition-base) 70%, var(--diffs-bg));
  }

  [data-background] [data-line-type="change-deletion"]:where([data-gutter-buffer], [data-column-number]) {
    --diffs-bg-deletion-number-override: color-mix(in oklch, var(--diffs-deletion-base) 30%, var(--diffs-bg));
    --diffs-fg-number-deletion-override: color-mix(in oklch, var(--diffs-deletion-base) 68%, var(--diffs-bg));
  }

  [data-indicators="bars"] [data-line-type="change-addition"][data-column-number]::before {
    background-color: color-mix(in oklch, var(--diffs-addition-base) 48%, var(--diffs-bg));
  }

  [data-indicators="bars"] [data-line-type="change-deletion"][data-column-number]::before {
    background-image: linear-gradient(
      0deg,
      color-mix(in oklch, var(--diffs-bg-deletion) 70%, var(--diffs-bg)) 50%,
      color-mix(in oklch, var(--diffs-deletion-base) 48%, var(--diffs-bg)) 50%
    );
  }

  [data-no-newline] {
    display: none;
  }
`

const baseDiffOptions = {
  diffStyle: "unified",
  overflow: "wrap",
  stickyHeader: true,
  unsafeCSS: wrapFillUnsafeCSS,
} as const

const baseFileOptions = {
  overflow: "wrap",
  stickyHeader: true,
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

const previewCardBackground = "var(--ousia-diff-card-bg)"

const previewFrameStyle = {
  backgroundColor: previewCardBackground,
  borderRadius: "14px",
  display: "block",
  maxHeight: "48dvh",
  overflowX: "hidden",
} satisfies CSSProperties

type PierreSurfaceStyle = CSSProperties & Record<`--${string}`, string>
type HeaderMetadataRenderer = () => ReactNode

const pierreSurfaceStyle = {
  display: "block",
} satisfies PierreSurfaceStyle

function revealablePreviewPath(preview: OusiaChatToolFilePreview) {
  if (preview.kind !== "diff" && preview.kind !== "patch") {
    return undefined
  }
  const path = preview.path?.trim()
  if (!path || path === "write" || path === "edit") {
    return undefined
  }
  return path
}

function RevealFileInFinderButton({
  path,
  projectPath,
  t,
}: {
  path: string
  projectPath?: string
  t: ReturnType<typeof getMessages>
}) {
  const [isOpening, setIsOpening] = useState(false)
  const canReveal = Boolean(window.ousia)

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!window.ousia || isOpening) {
      return
    }

    setIsOpening(true)
    void window.ousia
      .showFileInFinder({ path, projectPath })
      .then((result) => {
        if (!result.ok) {
          console.warn(t.chat.showFileInFinderFailed, result.error)
        }
      })
      .catch((error: unknown) => {
        console.warn(t.chat.showFileInFinderFailed, error)
      })
      .finally(() => {
        setIsOpening(false)
      })
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="window-no-drag -my-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/75 transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:bg-muted/55 focus-visible:text-foreground focus-visible:outline-none disabled:cursor-default disabled:opacity-45"
            aria-label={t.chat.showFileInFinder}
            disabled={!canReveal || isOpening}
            onClick={handleClick}
            title={t.chat.showFileInFinder}
          >
            <FolderOpen size={15} strokeWidth={1.6} />
          </button>
        </TooltipTrigger>
        <TooltipContent align="end" side="bottom">
          {t.chat.showFileInFinder}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function isScrolledToLatest(node: HTMLDivElement) {
  return (
    node.scrollHeight - node.scrollTop - node.clientHeight <
    SCROLL_TO_LATEST_THRESHOLD
  )
}

function hasScrollableContent(node: HTMLDivElement) {
  return node.scrollHeight > node.clientHeight + 2
}

function previewHeaderHeight(node: HTMLDivElement) {
  const host = node.firstElementChild
  if (!(host instanceof HTMLElement)) {
    return 0
  }
  const header = host.shadowRoot?.querySelector<HTMLElement>(
    "[data-diffs-header]"
  )
  return header?.offsetHeight ?? 0
}

function scrollThumbStyleForNode(node: HTMLDivElement): CSSProperties | null {
  if (!hasScrollableContent(node)) {
    return null
  }

  const headerHeight = previewHeaderHeight(node)
  const topInset = headerHeight
  const bottomInset = 8
  const minThumbHeight = 28
  const trackHeight = Math.max(0, node.clientHeight - topInset - bottomInset)
  const thumbHeight = Math.max(
    minThumbHeight,
    Math.round((node.clientHeight / node.scrollHeight) * trackHeight)
  )
  const maxScrollTop = node.scrollHeight - node.clientHeight
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight)
  const thumbTop =
    topInset +
    (maxScrollTop > 0 ? (node.scrollTop / maxScrollTop) * maxThumbTop : 0)

  return {
    height: thumbHeight,
    transform: `translateY(${Math.round(thumbTop)}px)`,
  }
}

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
    renderHeaderMetadata,
    themeType,
  }: {
    preview: Extract<OusiaChatToolFilePreview, { kind: "diff" }>
    renderHeaderMetadata?: HeaderMetadataRenderer
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
        renderHeaderMetadata={renderHeaderMetadata}
        style={pierreSurfaceStyle}
      />
    )
  }

  function PatchDiffPreview({
    preview,
    renderHeaderMetadata,
    themeType,
  }: {
    preview: Extract<OusiaChatToolFilePreview, { kind: "patch" }>
    renderHeaderMetadata?: HeaderMetadataRenderer
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
        renderHeaderMetadata={renderHeaderMetadata}
        style={pierreSurfaceStyle}
      />
    )
  }

  return {
    default: function PierreDiffPreview({
      preview,
      renderHeaderMetadata,
      themeType,
    }: {
      preview: OusiaChatToolFilePreview
      renderHeaderMetadata?: HeaderMetadataRenderer
      themeType: ResolvedTheme
    }) {
      if (preview.kind === "diff") {
        return (
          <GeneratedDiffPreview
            preview={preview}
            renderHeaderMetadata={renderHeaderMetadata}
            themeType={themeType}
          />
        )
      }

      if (preview.kind === "patch") {
        return (
          <PatchDiffPreview
            preview={preview}
            renderHeaderMetadata={renderHeaderMetadata}
            themeType={themeType}
          />
        )
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
  projectPath,
  t,
}: {
  preview: OusiaChatToolFilePreview
  projectPath?: string
  t: ReturnType<typeof getMessages>
}) {
  const { resolvedTheme } = useTheme()
  const frameRef = useRef<HTMLDivElement>(null)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [scrollThumbStyle, setScrollThumbStyle] =
    useState<CSSProperties | null>(null)
  const revealPath = revealablePreviewPath(preview)
  const renderHeaderMetadata = useMemo<HeaderMetadataRenderer | undefined>(
    () =>
      revealPath
        ? () => (
            <RevealFileInFinderButton
              path={revealPath}
              projectPath={projectPath}
              t={t}
            />
          )
        : undefined,
    [projectPath, revealPath, t]
  )

  useLayoutEffect(() => {
    const node = frameRef.current
    if (!node) {
      return
    }
    if (!isFollowingLatest) {
      setShowScrollToLatest(hasScrollableContent(node))
      setScrollThumbStyle(scrollThumbStyleForNode(node))
      return
    }
    node.scrollTop = node.scrollHeight
    setScrollThumbStyle(scrollThumbStyleForNode(node))
    setShowScrollToLatest(false)
  }, [isFollowingLatest, preview])

  useLayoutEffect(() => {
    const node = frameRef.current
    if (!node || typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(() => {
      setScrollThumbStyle(scrollThumbStyleForNode(node))
    })
    observer.observe(node)
    const contentNode = node.firstElementChild
    if (contentNode) {
      observer.observe(contentNode)
    }

    return () => {
      observer.disconnect()
    }
  }, [])

  function syncFollowState(node: HTMLDivElement) {
    const isAtLatest = isScrolledToLatest(node)
    setIsFollowingLatest(isAtLatest)
    setShowScrollToLatest(!isAtLatest && hasScrollableContent(node))
    setScrollThumbStyle(scrollThumbStyleForNode(node))
  }

  function handleWheelCapture(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY >= 0 || event.currentTarget.scrollTop <= 0) {
      return
    }
    setIsFollowingLatest(false)
    setShowScrollToLatest(hasScrollableContent(event.currentTarget))
  }

  function scrollToLatest(behavior: ScrollBehavior = "auto") {
    const node = frameRef.current
    if (!node) {
      return
    }
    setIsFollowingLatest(true)
    setShowScrollToLatest(false)
    node.scrollTo({
      behavior,
      top: node.scrollHeight,
    })
    setScrollThumbStyle(scrollThumbStyleForNode(node))
  }

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
    <div className="relative mt-1.5">
      <div
        ref={frameRef}
        className="ousia-diff-preview-frame ousia-squircle-corners"
        onScroll={(event) => {
          syncFollowState(event.currentTarget)
        }}
        onWheelCapture={handleWheelCapture}
        style={previewFrameStyle}
      >
        <Suspense
          fallback={
            <div className="px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
              {t.chat.toolPayloadLoading}
            </div>
          }
        >
          <LazyPierreDiffPreview
            preview={preview}
            renderHeaderMetadata={renderHeaderMetadata}
            themeType={resolvedTheme}
          />
        </Suspense>
      </div>

      {scrollThumbStyle ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 z-20 w-1 rounded-full bg-muted-foreground/20"
          style={scrollThumbStyle}
        />
      ) : null}

      {showScrollToLatest ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="pointer-events-auto size-6 rounded-full border-[0.5px] border-foreground/10 bg-popover/90 text-popover-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.72),inset_0_0_0_1px_rgba(255,255,255,0.22),0_4px_14px_rgba(0,0,0,0.045),0_1px_5px_rgba(0,0,0,0.025)] backdrop-blur hover:bg-popover/95 dark:border-foreground/10 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(255,255,255,0.04),0_4px_14px_rgba(0,0,0,0.22),0_1px_5px_rgba(0,0,0,0.12)]"
            aria-label={t.chat.scrollToLatest}
            onClick={() => {
              scrollToLatest("smooth")
            }}
          >
            <SendArrowDown className="size-[18px]" strokeWidth={1.5} />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
