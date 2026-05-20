export type OusiaChatContext = {
  projectPath: string
  sessionId: string
}

export type OusiaThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"

export type OusiaModelSettings = {
  provider: string
  modelId: string
  apiKey?: string
}

export type OusiaTextChatItem = {
  id: string
  role: "user" | "assistant" | "thinking" | "system" | "error"
  text: string
  status?: "streaming" | "finished"
}

export type OusiaChatHistoryItem =
  | OusiaTextChatItem
  | {
      id: string
      role: "tool"
      name: string
      text: string
      status: "running" | "finished" | "failed"
    }

export type OusiaChatEvent = {
  context?: OusiaChatContext
} & (
  | {
      type: "user_message"
      id: string
      text: string
      timestamp: string
    }
  | {
      type: "assistant_text_start"
      id: string
      timestamp: string
    }
  | {
      type: "assistant_text_delta"
      id: string
      delta: string
      timestamp: string
    }
  | {
      type: "assistant_text_end"
      id: string
      text?: string
      timestamp: string
    }
  | {
      type: "thinking_start"
      id: string
      timestamp: string
    }
  | {
      type: "thinking_delta"
      id: string
      delta: string
      timestamp: string
    }
  | {
      type: "thinking_end"
      id: string
      text?: string
      timestamp: string
    }
  | {
      type: "tool_start"
      id: string
      name: string
      args?: unknown
      timestamp: string
    }
  | {
      type: "tool_update"
      id: string
      value?: unknown
      timestamp: string
    }
  | {
      type: "tool_end"
      id: string
      name?: string
      result?: unknown
      isError?: boolean
      timestamp: string
    }
  | {
      type: "run_status"
      status: "starting" | "running" | "finished" | "error"
      text?: string
      timestamp: string
    }
  | {
      type: "error"
      id: string
      text: string
      timestamp: string
    }
)

export type OusiaChatSendResult = {
  ok: boolean
}

export type OusiaChatInterruptResult = {
  ok: boolean
}

export type OusiaChatSendPayload = OusiaChatContext & {
  prompt: string
  thinkingLevel: OusiaThinkingLevel
  model: OusiaModelSettings
}

export type OusiaChatHistoryResult = {
  items: OusiaChatHistoryItem[]
}

export type OusiaOpenProjectResult =
  | {
      canceled: true
    }
  | {
      canceled: false
      path: string
      name: string
    }

export type OusiaEditorFileEntry = {
  path: string
  name: string
  depth: number
  extension: string
}

export type OusiaEditorListFilesPayload = {
  projectPath: string
}

export type OusiaEditorListFilesResult = {
  files: OusiaEditorFileEntry[]
}

export type OusiaEditorReadFilePayload = {
  projectPath: string
  path: string
}

export type OusiaEditorReadFileResult = {
  content: string
  path: string
}

export type OusiaEditorSaveFilePayload = {
  projectPath: string
  path: string
  content: string
}

export type OusiaEditorSaveFileResult = {
  ok: boolean
}

export type OusiaTerminalContext = OusiaChatContext & {
  terminalId: string
}

export type OusiaTerminalCreatePayload = OusiaTerminalContext & {
  cols: number
  rows: number
}

export type OusiaTerminalCreateResult = {
  terminalId: string
}

export type OusiaTerminalWritePayload = OusiaTerminalContext & {
  data: string
}

export type OusiaTerminalResizePayload = OusiaTerminalContext & {
  cols: number
  rows: number
}

export type OusiaTerminalDisposePayload = OusiaTerminalContext

export type OusiaTerminalOperationResult = {
  ok: boolean
}

export type OusiaTerminalEvent =
  | {
      type: "data"
      terminalId: string
      data: string
    }
  | {
      type: "exit"
      terminalId: string
      exitCode?: number
      signal?: number
    }
  | {
      type: "error"
      terminalId: string
      message: string
    }

export type OusiaRuntimeWidgetSlot = "workspace.tab"

export type OusiaRuntimeWidget = {
  id: string
  title: string
  slot: OusiaRuntimeWidgetSlot
  sourcePath: string
  code: string
}

export type OusiaRuntimeWidgetError = {
  id: string
  title: string
  sourcePath?: string
  message: string
}

export type OusiaRuntimeWidgetsPayload = {
  projectPath?: string
}

export type OusiaRuntimeWidgetsChangedEvent = {
  widgetsDirs: string[]
}

export type OusiaRuntimeWidgetsResult = {
  widgetsDir: string
  widgetsDirs: string[]
  widgets: OusiaRuntimeWidget[]
  errors: OusiaRuntimeWidgetError[]
}

export type OusiaWindowFullscreenEvent = {
  isFullscreen: boolean
}
