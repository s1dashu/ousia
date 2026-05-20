import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { Search01Icon } from "@hugeicons/core-free-icons"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { FolderTree, Loader2, Save } from "lucide-react"
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js"
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js"
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
import type { WidgetProps } from "@/widgets/types"

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

const treeStyle: TreeStyle = {
  "--trees-bg-override": "#181818",
  "--trees-bg-muted-override": "#2a2d2e",
  "--trees-selected-bg-override": "#37373d",
  "--trees-selected-fg-override": "#ffffff",
  "--trees-fg-override": "#cccccc",
  "--trees-fg-muted-override": "#858585",
  "--trees-border-color-override": "#2b2b2b",
  "--trees-focus-ring-color-override": "#0078d4",
  "--trees-input-bg-override": "#202020",
  "--trees-search-bg-override": "#202020",
  "--trees-search-fg-override": "#cccccc",
  "--trees-search-font-weight-override": "400",
  "--trees-font-family-override":
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  "--trees-font-size-override": "12px",
  "--trees-item-height": "28px",
  "--trees-padding-inline-override": "6px",
  "--trees-item-margin-x-override": "0px",
  "--trees-item-padding-x-override": "6px",
  "--trees-border-radius-override": "0px",
  height: "100%",
}

function toSvgAttributeName(name: string) {
  return name.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)
}

function hugeIconMaskUrl(icon: typeof Search01Icon) {
  const paths = icon
    .map(([tag, attributes]) => {
      const attributeText = Object.entries(attributes)
        .filter(([name]) => name !== "key")
        .map(
          ([name, value]) =>
            `${toSvgAttributeName(name)}="${String(value).replace(
              "currentColor",
              "black"
            )}"`
        )
        .join(" ")
      return `<${tag} ${attributeText}/>`
    })
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${paths}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const searchIconMask = hugeIconMaskUrl(Search01Icon)

const treeUnsafeCSS = `
  [data-file-tree-search-container] {
    position: relative;
    padding-inline: 8px;
    margin-block: 8px 6px;
  }

  [data-file-tree-search-container]::before {
    content: "";
    position: absolute;
    left: 17px;
    top: 50%;
    width: 14px;
    height: 14px;
    transform: translateY(-50%);
    pointer-events: none;
    opacity: 0.72;
    background-color: var(--trees-fg-muted);
    -webkit-mask: ${searchIconMask} center / 14px 14px no-repeat;
    mask: ${searchIconMask} center / 14px 14px no-repeat;
  }

  [data-file-tree-search-input] {
    height: 28px;
    margin-block: 0;
    padding-inline: 32px 9px;
    color: var(--trees-search-fg);
    background: var(--trees-search-bg);
    border: 1px solid #2b2b2b;
    border-radius: 5px;
    line-height: 28px;
    box-shadow: none;
  }

  [data-file-tree-search-input]::placeholder {
    color: #858585;
    opacity: 1;
  }

  [data-file-tree-search-input]:hover {
    border-color: #3a3a3a;
  }

  [data-file-tree-search-input]:focus-visible,
  [data-file-tree-search-input][data-file-tree-search-input-fake-focus='true'] {
    border-color: #0078d4;
    outline: 1px solid #0078d4;
    outline-offset: -1px;
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
    "scrollbarSlider.background": "#79797966",
    "scrollbarSlider.hoverBackground": "#646464b3",
    "scrollbarSlider.activeBackground": "#bfbfbf66",
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

export function EditorWidget({ context }: WidgetProps) {
  const editorElementRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [files, setFiles] = useState<OusiaEditorFileEntry[]>([])
  const [activePath, setActivePath] = useState("")
  const [status, setStatus] = useState("Select a file")
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const projectPath = context.project.path
  const treePaths = useMemo(() => files.map((file) => file.path), [files])
  const filePathSetRef = useRef(new Set<string>())
  const { model: fileTreeModel } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "expand-matches",
    flattenEmptyDirectories: true,
    icons: "complete",
    initialExpansion: 2,
    onSelectionChange: (selectedPaths) => {
      const nextPath = selectedPaths.find((path) =>
        filePathSetRef.current.has(path)
      )
      if (nextPath) {
        setActivePath(nextPath)
      }
    },
    paths: [],
    search: true,
    unsafeCSS: treeUnsafeCSS,
  })
  const activeFile = useMemo(
    () => files.find((file) => file.path === activePath),
    [activePath, files]
  )

  useEffect(() => {
    filePathSetRef.current = new Set(treePaths)
  }, [treePaths])

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
        "Menlo, Monaco, 'SF Mono', Consolas, 'Liberation Mono', monospace",
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
        setStatus("Unsaved changes")
      }
    )
    const selectionSubscription = editorRef.current.onDidChangeCursorSelection(
      (event) => {
        editorRef.current?.updateOptions({
          renderLineHighlight: event.selection.isEmpty() ? "line" : "none",
        })
      }
    )

    return () => {
      contentSubscription.dispose()
      selectionSubscription.dispose()
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!projectPath || !window.ousia) {
      queueMicrotask(() => {
        setFiles([])
        setActivePath("")
        setStatus("Open a project to browse files")
      })
      return
    }

    let isCancelled = false
    queueMicrotask(() => {
      if (!isCancelled) {
        setIsLoadingFiles(true)
        setStatus("Loading files...")
      }
    })
    window.ousia
      .listEditorFiles({ projectPath })
      .then((result) => {
        if (isCancelled) {
          return
        }
        setFiles(result.files)
        const nextPath = result.files[0]?.path ?? ""
        setActivePath(nextPath)
        setStatus(
          result.files.length
            ? `${result.files.length} files indexed`
            : "No editable source files found"
        )
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setFiles([])
          setActivePath("")
          setStatus(
            error instanceof Error ? error.message : "Failed to load files"
          )
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
  }, [projectPath])

  useEffect(() => {
    if (!activePath || !projectPath || !window.ousia) {
      editorRef.current?.setValue("")
      return
    }

    let isCancelled = false
    queueMicrotask(() => {
      if (!isCancelled) {
        setIsReading(true)
        setStatus(`Opening ${activePath}`)
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
        setIsDirty(false)
        setStatus(result.path)
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setStatus(
            error instanceof Error ? error.message : "Failed to open file"
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
  }, [activePath, projectPath])

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
      setStatus(`Saved ${activePath}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save file")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#1e1e1e] text-[#cccccc]">
      <aside className="flex w-[244px] shrink-0 flex-col border-r border-[#2b2b2b] bg-[#181818]">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#2b2b2b] px-3 text-xs font-semibold text-[#cccccc]">
          <FolderTree className="size-4 text-muted-foreground" />
          <span className="min-w-0 truncate">{context.project.name}</span>
        </div>
        <div className="relative min-h-0 flex-1">
          {isLoadingFiles ? (
            <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-[#181818] px-3 py-2 text-xs text-[#858585]">
              <Loader2 className="size-3.5 animate-spin" />
              Indexing
            </div>
          ) : null}
          <FileTree model={fileTreeModel} style={treeStyle} />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#2b2b2b] bg-[#181818] px-2">
          <div className="min-w-0 flex-1 truncate font-mono text-xs text-[#cccccc]/80">
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
            <span>{isDirty ? "Save" : "Saved"}</span>
          </Button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div ref={editorElementRef} className="absolute inset-0" />
          {isReading ? (
            <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-2 rounded-md border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Opening
            </div>
          ) : null}
        </div>
        <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#2b2b2b] bg-[#181818] px-2 font-mono text-[11px] text-[#cccccc]/75">
          <span className="min-w-0 truncate">{status}</span>
          <span>{languageForPath(activePath)}</span>
        </div>
      </section>
    </div>
  )
}
