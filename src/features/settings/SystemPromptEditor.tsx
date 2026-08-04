import { useMemo } from "react"
import CodeMirror, { EditorView } from "@uiw/react-codemirror"
import { markdown } from "@codemirror/lang-markdown"

import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

type SystemPromptEditorProps = {
  ariaLabel: string
  disabled: boolean
  editable: boolean
  onChange: (value: string) => void
  placeholder: string
  value: string
}

export function SystemPromptEditor({
  ariaLabel,
  disabled,
  editable,
  onChange,
  placeholder,
  value,
}: SystemPromptEditorProps) {
  const { resolvedTheme } = useTheme()
  const canEdit = editable && !disabled
  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
      EditorView.theme(
        {
          "&": {
            height: "100%",
            backgroundColor: "transparent",
            color: "var(--foreground)",
            fontSize: "0.875rem",
          },
          "&.cm-focused": { outline: "none" },
          ".cm-scroller": {
            fontFamily: "var(--font-mono)",
            lineHeight: "1.5rem",
            minHeight: "0",
            overflowX: "auto",
            overflowY: "auto",
          },
          ".cm-content": {
            caretColor: "var(--foreground)",
            padding: "0.5rem 0",
          },
          ".cm-line": { padding: "0 0.625rem" },
          ".cm-gutters": {
            backgroundColor: "transparent",
            border: "none",
            borderRight: "1px solid var(--border)",
            color: "var(--muted-foreground)",
          },
          ".cm-lineNumbers .cm-gutterElement": {
            minWidth: "2.75rem",
            padding: "0 0.625rem 0 0.5rem",
          },
          ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor:
              "color-mix(in oklch, var(--muted) 58%, transparent)",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--foreground)",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection":
            {
              backgroundColor:
                "color-mix(in oklch, var(--primary) 68%, transparent) !important",
            },
          ".cm-panels": {
            backgroundColor: "var(--popover)",
            color: "var(--popover-foreground)",
          },
          ".cm-panels.cm-panels-top": {
            borderBottom: "1px solid var(--border)",
          },
          ".cm-searchMatch": {
            backgroundColor:
              "color-mix(in oklch, var(--primary) 22%, transparent)",
            outline: "1px solid color-mix(in oklch, var(--primary) 42%, transparent)",
          },
        },
        { dark: resolvedTheme === "dark" }
      ),
    ],
    [ariaLabel, resolvedTheme]
  )

  return (
    <div
      className={cn(
        "h-[32rem] min-h-64 max-h-[60vh] overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] dark:bg-input/30",
        canEdit &&
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        disabled && "cursor-not-allowed opacity-50"
      )}
      data-system-prompt-editor
    >
      <CodeMirror
        autoFocus={canEdit}
        basicSetup={{
          autocompletion: false,
          closeBrackets: false,
          closeBracketsKeymap: false,
          completionKeymap: false,
          foldGutter: false,
          foldKeymap: false,
          highlightActiveLine: canEdit,
          highlightActiveLineGutter: canEdit,
          lintKeymap: false,
          lineNumbers: true,
          searchKeymap: true,
        }}
        className="h-full min-h-0"
        editable={canEdit}
        extensions={extensions}
        height="100%"
        indentWithTab
        onChange={onChange}
        placeholder={placeholder}
        readOnly={!canEdit}
        theme="none"
        value={value}
      />
    </div>
  )
}
