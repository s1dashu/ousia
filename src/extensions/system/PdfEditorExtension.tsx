import { PDFViewer } from "@embedpdf/react-pdf-viewer"
import type {
  Command,
  PluginRegistry,
  SelectionCapability,
  SelectionMenuItem,
  UICapability,
} from "@embedpdf/react-pdf-viewer"
import { useCallback, useEffect, useRef, useState } from "react"

import type { ExtensionProps } from "@/extensions/types"

type OpenPdfArgs = {
  path: string
  name?: string
  projectPath?: string
  src?: string
}

const quoteSelectionCommandId = "ousia:quote-selection-to-input"
const quoteSelectionItemId = "ousia-quote-selection-to-input"
const quoteSelectionIconId = "ousia-quote-to-chat"

function isOpenPdfArgs(value: unknown): value is OpenPdfArgs {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { path?: unknown }).path === "string"
  )
}

export function PdfEditorExtension({ context }: ExtensionProps) {
  const [source, setSource] = useState<string>("")
  const lastActionIdRef = useRef("")
  const currentFileRef = useRef<OpenPdfArgs | null>(null)

  const loadPdfFromFile = useCallback(async (path: string, projectPath: string) => {
    if (!window.ousia) {
      return
    }
    try {
      const file = await window.ousia.readPdfFile({ projectPath, path })
      const bytes = Uint8Array.from(atob(file.contentBase64), (char) =>
        char.charCodeAt(0)
      )
      const blob = new Blob([bytes], { type: "application/pdf" })
      setSource(URL.createObjectURL(blob))
    } catch {
      // Restoring a workspace tab should not crash the PDF viewer.
    }
  }, [])

  useEffect(() => {
    const action = context.action
    if (
      !action ||
      action.requestId === lastActionIdRef.current ||
      action.extensionId !== "extension.firstParty.pdfEditor"
    ) {
      return
    }
    lastActionIdRef.current = action.requestId

    if (action.action === "openAndFocus") {
      return
    }

    if (action.action !== "openFile") {
      return
    }
    if (!isOpenPdfArgs(action.args) || typeof action.args.path !== "string") {
      return
    }

    const args = action.args
    currentFileRef.current = args
    if (typeof args.src === "string") {
      queueMicrotask(() => setSource(args.src!))
      return
    }
    queueMicrotask(() => {
      void loadPdfFromFile(args.path, args.projectPath ?? context.project.path)
    })
  }, [context.action, context.project.path, loadPdfFromFile])

  const quoteSelectionToInput = useCallback(
    (registry: PluginRegistry, documentId: string) => {
      if (!context.agent.quoteToInput) {
        return
      }

      const selection = registry
        .getCapabilityProvider("selection")
        ?.provides() as SelectionCapability | undefined
      if (!selection) {
        return
      }

      selection.getSelectedText(documentId).wait(
        (parts) => {
          const text = parts.join("\n").trim()
          if (!text || !context.agent.quoteToInput) {
            return
          }

          const currentFile = currentFileRef.current
          void context.agent.quoteToInput({
            source: {
              extensionId: context.extensionId,
              tabId: context.tabId,
              title: currentFile?.name ?? currentFile?.path ?? "PDF 选区",
            },
            quote: { text },
          })
        },
        () => {
          // Losing the transient PDF selection should not interrupt the viewer.
        }
      )
    },
    [context.agent, context.extensionId, context.tabId]
  )

  const handleViewerReady = useCallback(
    (registry: PluginRegistry) => {
      const commands = registry
        .getCapabilityProvider("commands")
        ?.provides() as
        | {
            registerCommand(command: Command): void
            unregisterCommand(commandId: string): void
          }
        | undefined
      const ui = registry
        .getCapabilityProvider("ui")
        ?.provides() as UICapability | undefined
      if (!commands || !ui) {
        return
      }

      try {
        commands.unregisterCommand(quoteSelectionCommandId)
      } catch {
        // The command may not exist when this viewer instance is first created.
      }

      commands.registerCommand({
        id: quoteSelectionCommandId,
        label: "引用到会话",
        icon: quoteSelectionIconId,
        action: ({ documentId }) => {
          void quoteSelectionToInput(registry, documentId)
        },
        disabled: ({ registry, documentId }) => {
          const selection = registry
            .getCapabilityProvider("selection")
            ?.provides() as SelectionCapability | undefined
          return !selection?.getState(documentId).selection
        },
        categories: ["selection", "selection-quote"],
      })

      const schema = ui.getSchema()
      const selectionMenu = schema.selectionMenus.selection
      if (!selectionMenu) {
        return
      }
      if (
        selectionMenu.items.some((item) => item.id === quoteSelectionItemId)
      ) {
        return
      }

      const nextItems: SelectionMenuItem[] = [
        {
          type: "command-button",
          id: quoteSelectionItemId,
          commandId: quoteSelectionCommandId,
          variant: "icon",
          categories: ["selection", "selection-quote"],
        },
        ...selectionMenu.items,
      ]

      ui.mergeSchema({
        selectionMenus: {
          selection: {
            ...selectionMenu,
            visibilityDependsOn: {
              itemIds: [
                ...(selectionMenu.visibilityDependsOn?.itemIds ?? []),
                quoteSelectionItemId,
              ],
            },
            items: nextItems,
          },
        },
      })
    },
    [quoteSelectionToInput]
  )

  return (
    <section className="h-full min-h-0 overflow-hidden bg-background text-foreground">
      <PDFViewer
        key={source || "empty"}
        config={{
          ...(source ? { src: source } : {}),
          theme: { preference: context.theme.resolved },
          icons: {
            [quoteSelectionIconId]: {
              viewBox: "0 0 24 24",
              strokeWidth: 2,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              paths: [
                {
                  d: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z",
                  stroke: "primary",
                  fill: "none",
                },
                {
                  d: "M8 9h3v3H9v2H7v-3c0-1.1.9-2 2-2zM14 9h3v3h-2v2h-2v-3c0-1.1.9-2 2-2z",
                  fill: "primary",
                },
              ],
            },
          },
          annotations: { annotationAuthor: "Ousia" },
          permissions: { enforceDocumentPermissions: false },
        }}
        style={{ width: "100%", height: "100%" }}
        onReady={handleViewerReady}
      />
    </section>
  )
}
