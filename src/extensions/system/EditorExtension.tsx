import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { FileCode, Folder, FolderOpen, Loader2, Save } from "lucide-react"
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import "monaco-editor/esm/vs/basic-languages/css/css.contribution.js"
import "monaco-editor/esm/vs/basic-languages/html/html.contribution.js"
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js"
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js"
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"
import "monaco-editor/esm/vs/language/css/monaco.contribution.js"
import "monaco-editor/esm/vs/language/html/monaco.contribution.js"
import "monaco-editor/esm/vs/language/json/monaco.contribution.js"
import "monaco-editor/esm/vs/language/typescript/monaco.contribution.js"
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker"
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker"

import { Button } from "@/components/ui/button"
import type { OusiaEditorFileEntry } from "@/electron/chat-types"
import type { ExtensionProps } from "@/extensions/types"
import type { ResolvedTheme } from "@/components/theme-provider"

const monacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") {
      return new jsonWorker()
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker()
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker()
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker()
    }
    return new editorWorker()
  },
}

type TreeStyle = CSSProperties & Record<`--${string}`, string | number>

function createTreeStyle(theme: ResolvedTheme): TreeStyle {
  return {
    "--trees-bg-override": theme === "dark" ? "#181818" : "#ffffff",
    "--trees-bg-muted-override":
      theme === "dark" ? "#2a2d2e" : "var(--sidebar-accent)",
    "--trees-selected-bg-override": "var(--sidebar-accent)",
    "--trees-selected-fg-override": "var(--sidebar-accent-foreground)",
    "--trees-fg-override": theme === "dark" ? "#cccccc" : "#24292f",
    "--trees-fg-muted-override": theme === "dark" ? "#858585" : "#6e7781",
    "--trees-border-color-override": theme === "dark" ? "#2b2b2b" : "#d8dee4",
    "--trees-focus-ring-color-override": "var(--sidebar-accent)",
    "--trees-focus-ring-width-override": "0px",
    "--trees-input-bg-override": theme === "dark" ? "#202020" : "#ffffff",
    "--trees-font-family-override":
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    "--trees-font-size-override": "12px",
    "--trees-item-height": "28px",
    "--trees-padding-inline-override": "6px",
    "--trees-item-margin-x-override": "6px",
    "--trees-item-padding-x-override": "6px",
    "--trees-border-radius-override": "8px",
    height: "100%",
    minHeight: 0,
    width: "100%",
  }
}

const treeUnsafeCSS = `
  :host,
  [data-file-tree-virtualized-wrapper='true'],
  [data-file-tree-virtualized-root='true'] {
    flex: 1 1 auto;
    min-height: 0;
    max-height: 100%;
  }

  [data-file-tree-virtualized-scroll='true'] {
    flex: 1 1 0;
    height: auto;
    min-height: 0;
    max-height: 100%;
  }
`

;(
  globalThis as typeof globalThis & { MonacoEnvironment?: unknown }
).MonacoEnvironment = monacoEnvironment

monaco.editor.defineTheme("ousia-vscode-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "editorLineNumber.activeForeground": "#c6c6c6",
    "editorLineNumber.foreground": "#858585",
    "editorCursor.foreground": "#aeafad",
    "editor.lineHighlightBackground": "#2a2d2e",
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#3a3d41",
    "editorIndentGuide.background1": "#404040",
    "editorIndentGuide.activeBackground1": "#707070",
    "editorWhitespace.foreground": "#404040",
    "scrollbarSlider.background": "#00000000",
    "scrollbarSlider.hoverBackground": "#cccccc3d",
    "scrollbarSlider.activeBackground": "#cccccc5c",
  },
})

monaco.editor.defineTheme("ousia-vscode-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#1f1f1f",
    "editorLineNumber.activeForeground": "#0b0b0b",
    "editorLineNumber.foreground": "#6e7681",
    "editor.lineHighlightBackground": "#f6f8fa",
    "editor.selectionBackground": "#add6ff",
    "editor.inactiveSelectionBackground": "#e5ebf1",
    "scrollbarSlider.background": "#00000000",
    "scrollbarSlider.hoverBackground": "#6e76813d",
    "scrollbarSlider.activeBackground": "#6e76815c",
  },
})

function languageForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase()
  switch (extension) {
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return "javascript"
    case "css":
      return "css"
    case "html":
      return "html"
    case "json":
      return "json"
    case "md":
    case "mdx":
      return "markdown"
    case "sh":
      return "shell"
    case "sql":
      return "sql"
    case "ts":
    case "tsx":
      return "typescript"
    case "yaml":
    case "yml":
      return "yaml"
    default:
      return "plaintext"
  }
}

function compactPath(path: string) {
  const parts = path.split("/")
  if (parts.length <= 3) {
    return path
  }
  return `${parts[0]}/.../${parts.slice(-2).join("/")}`
}

type StoredEditorProjectState = {
  activePath?: string
}

type StoredEditorResourceState = {
  cursor?: {
    column: number
    lineNumber: number
  }
  scrollLeft?: number
  scrollTop?: number
}

function editorProjectStateKey(projectPath: string) {
  return projectPath || "default"
}

function editorResourceStateKey(projectPath: string, path: string) {
  return `${projectPath || "default"}:${path}`
}

export function EditorExtension({ context }: ExtensionProps) {
  const editorElementRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const activePathRef = useRef("")
  const [files, setFiles] = useState<OusiaEditorFileEntry[]>([])
  const [activePath, setActivePath] = useState("")
  const [status, setStatus] = useState("选择文件")
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isOpeningProject, setIsOpeningProject] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [fileLoadError, setFileLoadError] = useState("")
  const projectPath = context.project.path
  const resolvedTheme = context.theme.resolved
  const treeStyle = useMemo(
    () => createTreeStyle(resolvedTheme),
    [resolvedTheme]
  )
  const treePaths = useMemo(() => files.map((file) => file.path), [files])
  const editableFilePaths = useMemo(
    () =>
      files
        .filter((file) => file.kind === "file")
        .map((file) => file.path),
    [files]
  )
  const filePathSetRef = useRef(new Set<string>())
  const { model: fileTreeModel } = useFileTree({
    density: "compact",
    flattenEmptyDirectories: true,
    icons: "complete",
    initialExpansion: 2,
    itemHeight: 28,
    onSelectionChange: (selectedPaths) => {
      const nextPath = selectedPaths.find((path) =>
        filePathSetRef.current.has(path)
      )
      if (nextPath) {
        setActivePath(nextPath)
      }
    },
    paths: [],
    unsafeCSS: treeUnsafeCSS,
  })
  const activeFile = useMemo(
    () => files.find((file) => file.kind === "file" && file.path === activePath),
    [activePath, files]
  )

  useEffect(() => {
    filePathSetRef.current = new Set(editableFilePaths)
  }, [editableFilePaths])

  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])

  useEffect(() => {
    const element = editorElementRef.current
    if (!element || editorRef.current) {
      return
    }

    editorRef.current = monaco.editor.create(element, {
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      cursorBlinking: "smooth",
      fontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      fontLigatures: false,
      fontSize: 14,
      lineHeight: 22,
      minimap: {
        enabled: true,
        maxColumn: 80,
        renderCharacters: false,
        scale: 0.75,
        showSlider: "mouseover",
        side: "right",
        size: "proportional",
      },
      overviewRulerBorder: false,
      padding: { top: 12, bottom: 12 },
      renderFinalNewline: "dimmed",
      renderLineHighlight: "line",
      renderWhitespace: "selection",
      roundedSelection: false,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      scrollbar: {
        horizontalScrollbarSize: 6,
        verticalScrollbarSize: 6,
        useShadows: false,
      },
      tabSize: 2,
      theme: document.documentElement.classList.contains("dark")
        ? "ousia-vscode-dark"
        : "ousia-vscode-light",
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
      },
      value: "",
      wordWrap: "on",
    })

    const contentSubscription = editorRef.current.onDidChangeModelContent(
      () => {
        setIsDirty(true)
        setStatus("有未保存的修改")
      }
    )
    const selectionSubscription = editorRef.current.onDidChangeCursorSelection(
      (event) => {
        editorRef.current?.updateOptions({
          renderLineHighlight: event.selection.isEmpty() ? "line" : "none",
        })
        const path = activePathRef.current
        if (!path || !projectPath) {
          return
        }
        void context.state.set(
          "resource",
          editorResourceStateKey(projectPath, path),
          {
            cursor: event.selection.getPosition(),
            scrollLeft: editorRef.current?.getScrollLeft() ?? 0,
            scrollTop: editorRef.current?.getScrollTop() ?? 0,
          } satisfies StoredEditorResourceState
        )
      }
    )
    const scrollSubscription = editorRef.current.onDidScrollChange(() => {
      const path = activePathRef.current
      const editor = editorRef.current
      const cursor = editor?.getPosition()
      if (!path || !projectPath || !editor) {
        return
      }
      void context.state.set(
        "resource",
        editorResourceStateKey(projectPath, path),
        {
          ...(cursor ? { cursor } : {}),
          scrollLeft: editor.getScrollLeft(),
          scrollTop: editor.getScrollTop(),
        } satisfies StoredEditorResourceState
      )
    })

    return () => {
      contentSubscription.dispose()
      selectionSubscription.dispose()
      scrollSubscription.dispose()
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [context.state, projectPath])

  useEffect(() => {
    monaco.editor.setTheme(
      resolvedTheme === "dark" ? "ousia-vscode-dark" : "ousia-vscode-light"
    )
  }, [resolvedTheme])

  useEffect(() => {
    if (!projectPath || !window.ousia) {
      queueMicrotask(() => {
        setFiles([])
        setActivePath("")
        setStatus("打开项目后可浏览文件")
      })
      return
    }

    let isCancelled = false
    queueMicrotask(() => {
      if (!isCancelled) {
        setIsLoadingFiles(true)
        setFileLoadError("")
        setStatus("正在加载文件...")
      }
    })
    Promise.all([
      window.ousia.listEditorFiles({ projectPath }),
      context.state.get<StoredEditorProjectState>(
        "project",
        editorProjectStateKey(projectPath)
      ),
    ])
      .then(([result, storedState]) => {
        if (isCancelled) {
          return
        }
        setFiles(result.files)
        setFileLoadError("")
        const storedActivePath = storedState?.activePath
        const fileEntries = result.files.filter((file) => file.kind === "file")
        const nextPath =
          fileEntries.find((file) => file.path === storedActivePath)?.path ??
          fileEntries[0]?.path ??
          ""
        setActivePath(nextPath)
        setStatus(
          fileEntries.length
            ? `已索引 ${fileEntries.length} 个文件`
            : "空文件夹"
        )
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : "文件加载失败"
          setFiles([])
          setActivePath("")
          setFileLoadError(message)
          setStatus(message)
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingFiles(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [context.state, projectPath])

  useEffect(() => {
    if (!activePath || !projectPath || !window.ousia) {
      const previousModel = editorRef.current?.getModel()
      editorRef.current?.setModel(null)
      previousModel?.dispose()
      queueMicrotask(() => setIsDirty(false))
      return
    }

    let isCancelled = false
    queueMicrotask(() => {
      if (!isCancelled) {
        setIsReading(true)
        setStatus(`正在打开 ${activePath}`)
      }
    })
    window.ousia
      .readEditorFile({ projectPath, path: activePath })
      .then((result) => {
        if (isCancelled) {
          return
        }
        const model = monaco.editor.createModel(
          result.content,
          languageForPath(result.path),
          monaco.Uri.parse(`file:///${result.path}`)
        )
        const previousModel = editorRef.current?.getModel()
        editorRef.current?.setModel(model)
        previousModel?.dispose()
        void context.state
          .get<StoredEditorResourceState>(
            "resource",
            editorResourceStateKey(projectPath, result.path)
          )
          .then((storedState) => {
            if (isCancelled || !storedState || !editorRef.current) {
              return
            }
            const cursor = storedState.cursor
            if (cursor) {
              editorRef.current.setPosition(cursor)
            }
            editorRef.current.setScrollPosition({
              scrollLeft: storedState.scrollLeft ?? 0,
              scrollTop: storedState.scrollTop ?? 0,
            })
          })
        setIsDirty(false)
        setStatus(result.path)
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setStatus(
            error instanceof Error ? error.message : "文件打开失败"
          )
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsReading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [activePath, context.state, projectPath])

  useEffect(() => {
    if (!activePath || !projectPath) {
      return
    }
    void context.state.set("project", editorProjectStateKey(projectPath), {
      activePath,
    } satisfies StoredEditorProjectState)
  }, [activePath, context.state, projectPath])

  useEffect(() => {
    fileTreeModel.resetPaths(treePaths)
  }, [fileTreeModel, treePaths])

  useEffect(() => {
    if (!activePath) {
      return
    }
    const activeItem = fileTreeModel.getItem(activePath)
    activeItem?.select()
    fileTreeModel.scrollToPath(activePath, { focus: false, offset: "nearest" })
  }, [activePath, fileTreeModel])

  async function saveActiveFile() {
    if (!activePath || !projectPath || !window.ousia || !editorRef.current) {
      return
    }

    setIsSaving(true)
    try {
      await window.ousia.saveEditorFile({
        projectPath,
        path: activePath,
        content: editorRef.current.getValue(),
      })
      setIsDirty(false)
      setStatus(`已保存 ${activePath}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "文件保存失败")
    } finally {
      setIsSaving(false)
    }
  }

  async function openProjectDirectory() {
    if (!context.app?.openProjectDirectory || isOpeningProject) {
      return
    }

    setIsOpeningProject(true)
    try {
      await context.app.openProjectDirectory()
    } finally {
      setIsOpeningProject(false)
    }
  }

  const shouldShowEmptyState = !isLoadingFiles && !activePath
  const emptyStateTitle = projectPath
    ? fileLoadError || "空文件夹"
    : "打开文件夹开始编辑"
  const emptyStateDescription = projectPath
    ? fileLoadError
      ? "当前项目路径不可用。你可以打开另一个文件夹，或在设置里调整默认工作目录。"
      : "打开另一个文件夹，或在当前路径创建文件。"
    : "选择一个项目文件夹后，编辑器会在这里显示可编辑的源文件。"

  return (
    <div className="ousia-editor-surface flex h-full min-h-0 overflow-hidden bg-[#ffffff] text-[#24292f] dark:bg-[#1e1e1e] dark:text-[#cccccc]">
      <aside className="flex min-h-0 w-[244px] shrink-0 flex-col overflow-hidden border-r border-[#d8dee4] bg-[#ffffff] dark:border-[#2b2b2b] dark:bg-[#181818]">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#d8dee4] px-3 text-xs font-semibold text-[#24292f] dark:border-[#2b2b2b] dark:text-[#cccccc]">
          <Folder
            className="shrink-0 text-muted-foreground"
            size={18}
          />
          <span className="min-w-0 truncate">{context.project.name}</span>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {isLoadingFiles ? (
            <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-[#ffffff] px-3 py-2 text-xs text-[#6e7781] dark:bg-[#181818] dark:text-[#858585]">
              <Loader2 className="size-3.5 animate-spin" />
              正在索引
            </div>
          ) : null}
          <FileTree
            className="absolute inset-0"
            model={fileTreeModel}
            style={treeStyle}
          />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#d8dee4] bg-[#ffffff] px-2 dark:border-[#2b2b2b] dark:bg-[#181818]">
          <div className="min-w-0 flex-1 truncate font-mono text-xs text-[#57606a] dark:text-[#cccccc]/80">
            {activeFile ? compactPath(activeFile.path) : status}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!activePath || isSaving || !isDirty}
            onClick={() => void saveActiveFile()}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            <span>{isDirty ? "保存" : "已保存"}</span>
          </Button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div ref={editorElementRef} className="absolute inset-0" />
          {shouldShowEmptyState ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#ffffff] px-8 dark:bg-[#1e1e1e]">
              <div className="flex max-w-[420px] flex-col items-center text-center">
                <div className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-[#d8dee4] bg-[#f6f8fa] text-[#57606a] dark:border-[#2b2b2b] dark:bg-[#252526] dark:text-[#cccccc]/75">
                  <FileCode size={32} />
                </div>
                <h2 className="text-[15px] font-semibold text-[#24292f] dark:text-[#cccccc]">
                  {emptyStateTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#57606a] dark:text-[#cccccc]/70">
                  {emptyStateDescription}
                </p>
                {context.app?.openProjectDirectory ? (
                  <Button
                    type="button"
                    className="mt-5"
                    size="sm"
                    onClick={() => void openProjectDirectory()}
                    disabled={isOpeningProject}
                  >
                    {isOpeningProject ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <FolderOpen size={16} />
                    )}
                    <span>打开文件夹</span>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {isReading ? (
            <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-2 rounded-md border bg-popover px-2 py-1 text-xs text-muted-foreground dark:shadow-sm">
              <Loader2 className="size-3.5 animate-spin" />
              正在打开
            </div>
          ) : null}
        </div>
        <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#d8dee4] bg-[#ffffff] px-2 font-mono text-[11px] text-[#57606a] dark:border-[#2b2b2b] dark:bg-[#181818] dark:text-[#cccccc]/75">
          <span className="min-w-0 truncate">{status}</span>
          <span>{activePath ? languageForPath(activePath) : ""}</span>
        </div>
      </section>
    </div>
  )
}
