import type { OusiaChatHistoryItem } from "@/electron/chat-types"
import { shouldAutoExpandTool } from "@/features/chat/chat-tool-format"

type ToolDisclosureItem = Pick<
  Extract<OusiaChatHistoryItem, { role: "tool" }>,
  "inputComplete" | "name" | "status"
>

export function shouldAutoExpandToolDisclosure(item: ToolDisclosureItem) {
  return shouldAutoExpandTool(item.name) && item.status === "running"
}

export function shouldAutoCollapseToolDisclosure(
  previous: ToolDisclosureItem,
  current: ToolDisclosureItem
) {
  if (!shouldAutoExpandTool(previous.name) || previous.status !== "running") {
    return false
  }

  return (
    current.status !== "running" ||
    (previous.inputComplete !== true && current.inputComplete === true)
  )
}
