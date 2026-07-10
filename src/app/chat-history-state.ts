export type ChatHistoryLoadStatus =
  | "loading-initial"
  | "ready"
  | "loading-older"
  | "empty"
  | "error"

export function shouldResetEmptyChatHistory(
  status: ChatHistoryLoadStatus | undefined,
  itemCount: number
) {
  return itemCount === 0 && status === "ready"
}

export function shouldRetryChatHistoryAfterSelection(
  previousChatKey: string,
  selectedChatKey: string,
  status: ChatHistoryLoadStatus | undefined
) {
  return (
    Boolean(previousChatKey) &&
    previousChatKey !== selectedChatKey &&
    status === "error"
  )
}

export function shouldScheduleAutomaticChatHistoryRetry(
  completedAutomaticRetries: number
) {
  return completedAutomaticRetries < 1
}
