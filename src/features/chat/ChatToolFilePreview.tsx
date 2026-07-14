import {
  useCallback,
  useEffect,
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
import { decideFilePreviewFollowState } from "@/features/chat/chat-scroll-follow"
import {
  streamedToolPreviewReveals,
  type ToolPreviewTextRow,
} from "@/features/chat/chat-tool-preview-motion"
import { createPreviewSnapshotScheduler } from "@/features/chat/chat-tool-preview-scheduler"

const SCROLL_TO_LATEST_THRESHOLD = 24
const STREAMING_PREVIEW_UPDATE_INTERVAL_MS = 120
const STREAMING_PREVIEW_REVEAL_DURATION_MS = 150
const MAX_STREAMING_PREVIEW_REVEAL_ROWS = 12
const previewSchedulerClock = {
  clearTimeout: (timerId: number) => window.clearTimeout(timerId),
  now: () => performance.now(),
  setTimeout: (callback: () => void, delay: number) =>
    window.setTimeout(callback, delay),
}

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
    background-color: var(--ousia-diff-header-surface);
    box-shadow: inset 0 -1px 0 var(--ousia-diff-header-divider);
  }

  [data-diffs-header][data-sticky] {
    background-color: var(--ousia-diff-header-surface);
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

  @keyframes ousia-diff-stream-reveal {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  [data-ousia-diff-stream-reveal] {
    animation: ousia-diff-stream-reveal ${STREAMING_PREVIEW_REVEAL_DURATION_MS}ms ease var(--ousia-diff-stream-reveal-delay, 0ms) both;
  }

  @media (prefers-reduced-motion: reduce) {
    [data-ousia-diff-stream-reveal] {
      animation: none;
    }
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

const previewFrameStyle = {
  borderRadius: "14px",
  display: "block",
  maxHeight: "48dvh",
  overflowX: "hidden",
} satisfies CSSProperties

type PierreSurfaceStyle = CSSProperties & Record<`--${string}`, string>
type HeaderMetadataRenderer = () => ReactNode
type PierrePostRenderPhase = "mount" | "update" | "unmount"

type PierreTextRow = ToolPreviewTextRow & {
  node: HTMLElement
}

type ActivePierreTextReveal = {
  startOffset: number
  startedAt: number
  text: string
}

const pierreSurfaceStyle = {
  display: "block",
} satisfies PierreSurfaceStyle

function pierreTextRows(container: HTMLElement): PierreTextRow[] {
  const shadowRoot = container.shadowRoot
  if (!shadowRoot) {
    throw new Error("Pierre preview rendered without an open shadow root")
  }

  const rows: PierreTextRow[] = []
  const contentColumns =
    shadowRoot.querySelectorAll<HTMLElement>("[data-content]")
  contentColumns.forEach((column, columnIndex) => {
    const keyOccurrences = new Map<string, number>()
    column
      .querySelectorAll<HTMLElement>(":scope > [data-line]")
      .forEach((node) => {
        const baseKey = [
          columnIndex,
          node.dataset.lineIndex ?? "",
          node.dataset.line ?? "",
          node.dataset.altLine ?? "",
          node.dataset.lineType ?? "",
        ].join(":")
        const occurrence = keyOccurrences.get(baseKey) ?? 0
        keyOccurrences.set(baseKey, occurrence + 1)
        rows.push({
          key: `${baseKey}:${occurrence}`,
          node,
          text: node.textContent ?? "",
        })
      })
  })
  return rows
}

function wrapPierreTextSuffix(
  node: HTMLElement,
  startOffset: number,
  elapsedMilliseconds: number,
  revealMarker: string,
) {
  if (node.dataset.ousiaDiffStreamRevealApplied === revealMarker) {
    return
  }
  const document = node.ownerDocument
  const nodeFilter = document.defaultView?.NodeFilter
  if (!nodeFilter) {
    throw new Error("NodeFilter is unavailable for streamed diff animation")
  }

  const walker = document.createTreeWalker(node, nodeFilter.SHOW_TEXT)
  let remainingOffset = startOffset
  let startNode: Text | null = null
  let offsetInNode = 0
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text
    const textLength = textNode.data.length
    if (remainingOffset <= textLength) {
      startNode = textNode
      offsetInNode = remainingOffset
      break
    }
    remainingOffset -= textLength
  }
  if (!startNode) {
    throw new Error("Streamed diff reveal offset exceeded the rendered row")
  }

  const range = document.createRange()
  range.setStart(startNode, offsetInNode)
  range.setEnd(node, node.childNodes.length)
  const fragment = range.extractContents()
  const reveal = document.createElement("span")
  reveal.dataset.ousiaDiffStreamReveal = ""
  reveal.style.setProperty(
    "--ousia-diff-stream-reveal-delay",
    `${-Math.round(elapsedMilliseconds)}ms`,
  )
  reveal.append(fragment)
  node.append(reveal)
  node.dataset.ousiaDiffStreamRevealApplied = revealMarker
}

function usePierreStreamReveal(isStreaming: boolean) {
  const previousRowsRef = useRef<ToolPreviewTextRow[]>([])
  const activeRevealsRef = useRef(new Map<string, ActivePierreTextReveal>())
  const hasStreamedRef = useRef(isStreaming)

  return useCallback(
    (
      container: HTMLElement,
      _instance: unknown,
      phase: PierrePostRenderPhase,
    ) => {
      if (phase === "unmount") {
        previousRowsRef.current = []
        activeRevealsRef.current.clear()
        return
      }
      if (isStreaming) {
        hasStreamedRef.current = true
      }

      const rows = pierreTextRows(container)
      const currentRows = rows.map(({ key, text }) => ({ key, text }))
      const now = performance.now()
      if (hasStreamedRef.current) {
        const reveals = streamedToolPreviewReveals(
          previousRowsRef.current,
          currentRows,
          MAX_STREAMING_PREVIEW_REVEAL_ROWS,
        )
        for (const reveal of reveals) {
          activeRevealsRef.current.set(reveal.key, {
            startOffset: reveal.startOffset,
            startedAt: now,
            text: reveal.text,
          })
        }
      }

      const rowByKey = new Map(rows.map((row) => [row.key, row]))
      for (const [key, reveal] of activeRevealsRef.current) {
        const row = rowByKey.get(key)
        const elapsedMilliseconds = now - reveal.startedAt
        if (
          !row ||
          row.text !== reveal.text ||
          elapsedMilliseconds >= STREAMING_PREVIEW_REVEAL_DURATION_MS
        ) {
          activeRevealsRef.current.delete(key)
          continue
        }
        wrapPierreTextSuffix(
          row.node,
          reveal.startOffset,
          elapsedMilliseconds,
          `${reveal.startedAt}:${reveal.startOffset}`,
        )
      }
      previousRowsRef.current = currentRows
    },
    [isStreaming],
  )
}

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
            className="window-no-drag text-muted-foreground/75 hover:bg-muted/55 hover:text-foreground focus-visible:bg-muted/55 focus-visible:text-foreground -my-1 flex size-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none disabled:cursor-default disabled:opacity-45"
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
    "[data-diffs-header]",
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
    Math.round((node.clientHeight / node.scrollHeight) * trackHeight),
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
  const [
    { File, FileDiff, PatchDiff, WorkerPoolContextProvider, useWorkerPool },
    { parseDiffFromFile },
    { default: PierreDiffWorker },
  ] = await Promise.all([
    import("@pierre/diffs/react"),
    import("@pierre/diffs"),
    import("@pierre/diffs/worker/worker.js?worker"),
  ])

  const workerPoolOptions = {
    poolSize: 1,
    totalASTLRUCacheSize: 20,
    workerFactory: () => new PierreDiffWorker(),
  }
  const workerHighlighterOptions = { langs: [] }

  type ParsedGeneratedDiff = ReturnType<typeof parseDiffFromFile>

  function removeNoNewlineMetadata(
    fileDiff: ParsedGeneratedDiff,
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
      "",
    )
  }

  function GeneratedDiffPreview({
    onPostRender,
    preview,
    renderHeaderMetadata,
    themeType,
  }: {
    onPostRender: ReturnType<typeof usePierreStreamReveal>
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
    const options = useMemo(
      () => ({ ...diffOptionsByTheme[themeType], onPostRender }),
      [onPostRender, themeType],
    )

    return (
      <FileDiff
        fileDiff={fileDiff}
        options={options}
        renderHeaderMetadata={renderHeaderMetadata}
        style={pierreSurfaceStyle}
      />
    )
  }

  function PatchDiffPreview({
    onPostRender,
    preview,
    renderHeaderMetadata,
    themeType,
  }: {
    onPostRender: ReturnType<typeof usePierreStreamReveal>
    preview: Extract<OusiaChatToolFilePreview, { kind: "patch" }>
    renderHeaderMetadata?: HeaderMetadataRenderer
    themeType: ResolvedTheme
  }) {
    const patch = useMemo(
      () => stripNoNewlinePatchMetadata(preview.patch),
      [preview.patch],
    )
    const options = useMemo(
      () => ({ ...diffOptionsByTheme[themeType], onPostRender }),
      [onPostRender, themeType],
    )

    return (
      <PatchDiff
        options={options}
        patch={patch}
        renderHeaderMetadata={renderHeaderMetadata}
        style={pierreSurfaceStyle}
      />
    )
  }

  function DiffWorkerPoolBoundary({
    children,
    failureText,
    onWorkerSettled,
  }: {
    children: ReactNode
    failureText: string
    onWorkerSettled: () => void
  }) {
    const workerPool = useWorkerPool()
    const hasReportedFailureRef = useRef(false)
    const hadPendingWorkRef = useRef(false)
    const [failure, setFailure] = useState<{
      data: Record<string, unknown>
      message: string
    }>()

    useEffect(() => {
      function reportFailure(data: Record<string, unknown>, message: string) {
        if (hasReportedFailureRef.current) {
          return
        }
        hasReportedFailureRef.current = true
        console.error(`[chat.diff-worker] ${message}`, data)
        void window.ousia
          ?.reportFrontendError({
            data,
            kind: "chat-diff-worker",
            message,
          })
          .catch((error: unknown) => {
            console.error(
              "[chat.diff-worker] Failed to persist worker failure",
              error,
            )
          })
      }

      if (!workerPool) {
        const data = { managerState: "unavailable" }
        const message = "Chat diff worker pool is unavailable"
        reportFailure(data, message)
        return
      }
      return workerPool.subscribeToStatChanges((stats) => {
        const hasPendingWork =
          stats.activeTasks > 0 ||
          stats.busyWorkers > 0 ||
          stats.queuedTasks > 0
        if (hasPendingWork) {
          hadPendingWorkRef.current = true
        } else if (hadPendingWorkRef.current) {
          hadPendingWorkRef.current = false
          onWorkerSettled()
        }
        if (!stats.workersFailed || hasReportedFailureRef.current) {
          return
        }
        const data = {
          activeTasks: stats.activeTasks,
          busyWorkers: stats.busyWorkers,
          managerState: stats.managerState,
          queuedTasks: stats.queuedTasks,
          totalWorkers: stats.totalWorkers,
        }
        const message = "Chat diff worker pool failed"
        setFailure({ data, message })
        reportFailure(data, message)
      })
    }, [onWorkerSettled, workerPool])

    if (!workerPool || failure) {
      return (
        <pre className="m-0 px-2.5 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-[var(--ousia-tool-warning-strong)]">
          {failureText}
        </pre>
      )
    }

    return children
  }

  return {
    default: function PierreDiffPreview({
      isStreaming,
      preview,
      renderHeaderMetadata,
      themeType,
      workerFailureText,
      onWorkerSettled,
    }: {
      isStreaming: boolean
      preview: OusiaChatToolFilePreview
      renderHeaderMetadata?: HeaderMetadataRenderer
      themeType: ResolvedTheme
      workerFailureText: string
      onWorkerSettled: () => void
    }) {
      const onPostRender = usePierreStreamReveal(isStreaming)
      const fileOptions = useMemo(
        () => ({ ...fileOptionsByTheme[themeType], onPostRender }),
        [onPostRender, themeType],
      )
      let content: ReactNode
      if (preview.kind === "diff") {
        content = (
          <GeneratedDiffPreview
            onPostRender={onPostRender}
            preview={preview}
            renderHeaderMetadata={renderHeaderMetadata}
            themeType={themeType}
          />
        )
      } else if (preview.kind === "patch") {
        content = (
          <PatchDiffPreview
            onPostRender={onPostRender}
            preview={preview}
            renderHeaderMetadata={renderHeaderMetadata}
            themeType={themeType}
          />
        )
      } else if (preview.kind === "file") {
        content = (
          <File
            file={{
              cacheKey: `${preview.path}:file:${preview.content.length}`,
              contents: preview.content,
              name: preview.path,
            }}
            options={fileOptions}
            style={pierreSurfaceStyle}
          />
        )
      } else {
        content = (
          <pre className="m-0 px-2.5 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-[var(--ousia-tool-warning-strong)]">
            {preview.message}
          </pre>
        )
      }

      return (
        <WorkerPoolContextProvider
          highlighterOptions={workerHighlighterOptions}
          poolOptions={workerPoolOptions}
        >
          <DiffWorkerPoolBoundary
            failureText={workerFailureText}
            onWorkerSettled={onWorkerSettled}
          >
            {content}
          </DiffWorkerPoolBoundary>
        </WorkerPoolContextProvider>
      )
    },
  }
})

function useScheduledFilePreview(
  preview: OusiaChatToolFilePreview,
  isStreaming: boolean,
) {
  const [scheduledPreview, setScheduledPreview] = useState(preview)
  const [scheduler] = useState(() =>
    createPreviewSnapshotScheduler({
      clock: previewSchedulerClock,
      commit: setScheduledPreview,
      initialSnapshot: preview,
      intervalMilliseconds: STREAMING_PREVIEW_UPDATE_INTERVAL_MS,
    }),
  )

  useLayoutEffect(() => {
    scheduler.update(preview, isStreaming)
  }, [isStreaming, preview, scheduler])

  useEffect(() => {
    return () => scheduler.dispose()
  }, [scheduler])

  return scheduledPreview
}

export function ToolFilePreviewView({
  isStreaming,
  preview,
  projectPath,
  t,
}: {
  isStreaming: boolean
  preview: OusiaChatToolFilePreview
  projectPath?: string
  t: ReturnType<typeof getMessages>
}) {
  const { resolvedTheme } = useTheme()
  const scheduledPreview = useScheduledFilePreview(preview, isStreaming)
  const frameRef = useRef<HTMLDivElement>(null)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [scrollThumbStyle, setScrollThumbStyle] =
    useState<CSSProperties | null>(null)
  const revealPath = revealablePreviewPath(scheduledPreview)
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
    [projectPath, revealPath, t],
  )

  const syncAfterContentLayout = useCallback(
    (node: HTMLDivElement) => {
      if (isFollowingLatest) {
        node.scrollTop = node.scrollHeight
        setShowScrollToLatest(false)
      } else {
        setShowScrollToLatest(hasScrollableContent(node))
      }
      setScrollThumbStyle(scrollThumbStyleForNode(node))
    },
    [isFollowingLatest],
  )

  const handleWorkerSettled = useCallback(() => {
    const node = frameRef.current
    if (node) {
      syncAfterContentLayout(node)
    }
  }, [syncAfterContentLayout])

  useLayoutEffect(() => {
    const node = frameRef.current
    if (!node) {
      return
    }
    // Keep Ousia's synchronous layout follow here. Deferring this scroll lets
    // Pierre's worker-driven height update paint with the preview above bottom.
    syncAfterContentLayout(node)
  }, [scheduledPreview, syncAfterContentLayout])

  useLayoutEffect(() => {
    const node = frameRef.current
    if (!node || typeof ResizeObserver === "undefined") {
      return
    }

    let observedContentNode: Element | null = null
    const observer = new ResizeObserver(() => {
      syncAfterContentLayout(node)
    })

    const observeCurrentContent = () => {
      const contentNode = node.firstElementChild
      if (contentNode === observedContentNode) {
        return
      }
      if (observedContentNode) {
        observer.unobserve(observedContentNode)
      }
      observedContentNode = contentNode
      if (observedContentNode) {
        observer.observe(observedContentNode)
      }
    }

    observer.observe(node)
    observeCurrentContent()
    const mutationObserver = new MutationObserver(() => {
      observeCurrentContent()
      syncAfterContentLayout(node)
    })
    mutationObserver.observe(node, { childList: true })

    return () => {
      mutationObserver.disconnect()
      observer.disconnect()
    }
  }, [syncAfterContentLayout])

  function syncFollowState(node: HTMLDivElement) {
    const isAtLatest = isScrolledToLatest(node)
    const nextState = decideFilePreviewFollowState({
      hasScrollableContent: hasScrollableContent(node),
      isAtLatest,
      isFollowingLatest,
    })
    setIsFollowingLatest(nextState.isFollowingLatest)
    setShowScrollToLatest(nextState.showScrollToLatest)
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

  if (scheduledPreview.kind === "error") {
    return (
      <div className="mt-1.5 rounded-md border border-[var(--ousia-tool-warning)] bg-[var(--ousia-tool-warning-bg)]">
        <pre className="m-0 px-2.5 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-[var(--ousia-tool-warning-strong)]">
          {scheduledPreview.message}
        </pre>
      </div>
    )
  }

  return (
    <div className="relative mt-1.5">
      <div
        ref={frameRef}
        data-chat-nested-scroll
        className="ousia-diff-preview-frame"
        onScroll={(event) => {
          syncFollowState(event.currentTarget)
        }}
        onWheelCapture={handleWheelCapture}
        style={previewFrameStyle}
      >
        <Suspense
          fallback={
            <div className="text-muted-foreground px-2.5 py-2 text-[11px] leading-4">
              {t.chat.toolPayloadLoading}
            </div>
          }
        >
          <LazyPierreDiffPreview
            isStreaming={isStreaming}
            preview={scheduledPreview}
            renderHeaderMetadata={renderHeaderMetadata}
            themeType={resolvedTheme}
            workerFailureText={t.chat.diffPreviewWorkerFailed}
            onWorkerSettled={handleWorkerSettled}
          />
        </Suspense>
      </div>

      {scrollThumbStyle ? (
        <div
          aria-hidden="true"
          className="bg-muted-foreground/20 pointer-events-none absolute top-0 right-0 z-20 w-1 rounded-full"
          style={scrollThumbStyle}
        />
      ) : null}

      {showScrollToLatest ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="border-foreground/10 bg-popover/90 text-popover-foreground hover:bg-popover/95 dark:border-foreground/10 pointer-events-auto size-6 rounded-full border-[0.5px] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),inset_0_0_0_1px_rgba(255,255,255,0.22),0_4px_14px_rgba(0,0,0,0.045),0_1px_5px_rgba(0,0,0,0.025)] backdrop-blur dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_0_0_1px_rgba(255,255,255,0.04),0_4px_14px_rgba(0,0,0,0.22),0_1px_5px_rgba(0,0,0,0.12)]"
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
