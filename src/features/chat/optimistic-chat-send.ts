import {
  createOusiaUserMessageEvent,
  type OusiaChatAttachment,
  type OusiaChatContext,
  type OusiaChatEvent,
} from "@/electron/chat-types"

export function createOptimisticUserMessage({
  attachments,
  context,
  messageId = `user-${globalThis.crypto.randomUUID()}`,
  text,
  timestamp = new Date().toISOString(),
}: {
  attachments: OusiaChatAttachment[]
  context: OusiaChatContext
  messageId?: string
  text: string
  timestamp?: string
}) {
  const event = createOusiaUserMessageEvent(
    {
      attachments,
      messageId,
      prompt: text,
      ...context,
    },
    timestamp,
    "optimistic"
  )
  return { event, messageId }
}

export async function sendChatMessageOptimistically<TResult>({
  event,
  onLocalEvent,
  send,
}: {
  event: Extract<OusiaChatEvent, { type: "user_message" }>
  onLocalEvent: (event: OusiaChatEvent) => void
  send: () => Promise<TResult>
}) {
  onLocalEvent(event)
  return send()
}

export function shouldEndOptimisticRunAfterBridgeFailure(
  wasAgentWorking: boolean
) {
  return !wasAgentWorking
}
