import type { OusiaChatHistoryItem } from "@/electron/chat-types"

export type ChatHistoryReconciliation = {
  anchorId?: string
  items: OusiaChatHistoryItem[]
  missingPersistedAnchor: boolean
  preservedLiveToolPayloadIds: string[]
  resolvedIds: ReadonlyMap<string, string>
  unmatchedTransientIds: string[]
}

export function markPersistedChatItems(
  items: OusiaChatHistoryItem[],
): OusiaChatHistoryItem[] {
  return items.map((item) =>
    item.isPersisted ? item : { ...item, isPersisted: true },
  )
}

export function persistedChatItemIds(items: OusiaChatHistoryItem[]) {
  return new Set(
    items.filter((item) => item.isPersisted).map((item) => item.id),
  )
}

export function reconcilePersistedChatHistory(
  existingItems: OusiaChatHistoryItem[],
  persistedItemsInput: OusiaChatHistoryItem[],
): ChatHistoryReconciliation {
  const persistedItems = markPersistedChatItems(persistedItemsInput)
  const persistedIndexes = new Map(
    persistedItems.map((item, index) => [item.id, index]),
  )
  let existingAnchorIndex = -1
  let persistedAnchorIndex = -1

  for (let index = existingItems.length - 1; index >= 0; index -= 1) {
    const item = existingItems[index]
    if (!item.isPersisted) {
      continue
    }
    const candidate = persistedIndexes.get(item.id)
    if (candidate !== undefined) {
      existingAnchorIndex = index
      persistedAnchorIndex = candidate
      break
    }
  }

  const hadPersistedItems = existingItems.some((item) => item.isPersisted)
  const existingSuffix = existingItems.slice(existingAnchorIndex + 1)
  const persistedSuffix = persistedItems.slice(persistedAnchorIndex + 1)
  const transientCandidates = existingSuffix.filter(isTransientChatContent)
  const usedTransientIds = new Set<string>()
  const resolvedIds = new Map<string, string>()
  const matchedTransientItems = new Map<string, OusiaChatHistoryItem>()
  let candidateIndex = 0

  for (const persistedItem of persistedSuffix) {
    for (
      let index = candidateIndex;
      index < transientCandidates.length;
      index += 1
    ) {
      const transientItem = transientCandidates[index]
      if (!chatItemsRepresentSameContent(transientItem, persistedItem)) {
        continue
      }
      usedTransientIds.add(transientItem.id)
      resolvedIds.set(transientItem.id, persistedItem.id)
      matchedTransientItems.set(persistedItem.id, transientItem)
      candidateIndex = index + 1
      break
    }
  }

  const unmatchedTransientIds = transientCandidates
    .filter((item) => !usedTransientIds.has(item.id))
    .map((item) => item.id)
  const localDecorations = existingSuffix.filter(isLocalDecoration)
  const prefix = existingItems.slice(0, existingAnchorIndex + 1)
  if (persistedAnchorIndex >= 0 && prefix.length) {
    prefix[prefix.length - 1] = persistedItems[persistedAnchorIndex]
  }
  const preservedLiveToolPayloadIds: string[] = []
  const reconciledPersistedSuffix = persistedSuffix.map((persistedItem) => {
    const reconciledItem = preserveLiveToolPayload(
      persistedItem,
      matchedTransientItems.get(persistedItem.id),
    )
    if (reconciledItem !== persistedItem) {
      preservedLiveToolPayloadIds.push(persistedItem.id)
    }
    return reconciledItem
  })

  return {
    anchorId:
      persistedAnchorIndex >= 0
        ? persistedItems[persistedAnchorIndex].id
        : undefined,
    items: [...prefix, ...reconciledPersistedSuffix, ...localDecorations],
    missingPersistedAnchor: hadPersistedItems && persistedAnchorIndex < 0,
    preservedLiveToolPayloadIds,
    resolvedIds,
    unmatchedTransientIds,
  }
}

function preserveLiveToolPayload(
  persistedItem: OusiaChatHistoryItem,
  transientItem: OusiaChatHistoryItem | undefined,
): OusiaChatHistoryItem {
  if (
    persistedItem.role !== "tool" ||
    transientItem?.role !== "tool" ||
    transientItem.inputComplete !== true ||
    transientItem.payloadOmitted === true
  ) {
    return persistedItem
  }
  return {
    ...persistedItem,
    input: transientItem.input ?? persistedItem.input,
    output: transientItem.output,
    errorText: transientItem.errorText,
    filePreview: transientItem.filePreview ?? persistedItem.filePreview,
    inputComplete: true,
    payloadOmitted: undefined,
  }
}

function isTransientChatContent(item: OusiaChatHistoryItem) {
  return !item.isPersisted && item.role !== "system" && item.role !== "error"
}

function isLocalDecoration(item: OusiaChatHistoryItem) {
  return !item.isPersisted && (item.role === "system" || item.role === "error")
}

function chatItemsRepresentSameContent(
  transientItem: OusiaChatHistoryItem,
  persistedItem: OusiaChatHistoryItem,
) {
  if (transientItem.role !== persistedItem.role) {
    return false
  }
  if (transientItem.role === "tool" && persistedItem.role === "tool") {
    return transientItem.id === persistedItem.id
  }
  if (transientItem.role === "user" && persistedItem.role === "user") {
    return userPromptsMatch(transientItem.text, persistedItem.text)
  }
  if (transientItem.role === "tool" || persistedItem.role === "tool") {
    return false
  }
  return transientItem.text === persistedItem.text
}

function userPromptsMatch(transientText: string, persistedText: string) {
  if (transientText === persistedText) {
    return true
  }
  if (!transientText || !persistedText.startsWith(transientText)) {
    return false
  }
  const appendedText = persistedText.slice(transientText.length)
  return (
    appendedText.startsWith("\n\n<attached_file ") ||
    appendedText.startsWith(
      "\n\nThe user attached a non-text file whose content is unavailable",
    )
  )
}
