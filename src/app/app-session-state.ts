import type { ChatItem } from "@/features/chat/chat-events"

export type ChatHistoryPageState = {
  cursor?: string
  error?: string
  hasMore: boolean
  status: "loading-initial" | "ready" | "loading-older" | "empty" | "error"
  totalItems?: number
}

export function moveRecordKey<T>(
  record: Record<string, T>,
  sourceKey: string,
  targetKey: string
) {
  if (
    sourceKey === targetKey ||
    !Object.prototype.hasOwnProperty.call(record, sourceKey)
  ) {
    return record
  }
  const next = { ...record }
  next[targetKey] = record[sourceKey]
  delete next[sourceKey]
  return next
}

export function historyPageStateFromResult(
  items: ChatItem[],
  history: {
    hasMore?: boolean
    nextCursor?: string
    totalItems?: number
  }
): ChatHistoryPageState {
  if (!items.length) {
    return {
      hasMore: false,
      status: "empty",
      totalItems: history.totalItems,
    }
  }
  return {
    cursor: history.hasMore ? (history.nextCursor ?? items[0]?.id) : undefined,
    hasMore: Boolean(history.hasMore),
    status: "ready",
    totalItems: history.totalItems,
  }
}

export function mergePersistedChatItems(
  existingItems: ChatItem[],
  persistedItems: ChatItem[]
) {
  if (!existingItems.length) {
    return persistedItems
  }
  if (!persistedItems.length) {
    return existingItems
  }
  const persistedIds = new Set(persistedItems.map((item) => item.id))
  return [
    ...persistedItems,
    ...existingItems.filter((item) => !persistedIds.has(item.id)),
  ]
}
