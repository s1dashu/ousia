import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"
import {
  Copy,
  FileImage,
  FileText,
  GitBranchPlus,
  LoaderCircle,
  Paperclip,
} from "@/components/icons/huge-icons"
import { Streamdown } from "streamdown"
import "streamdown/styles.css"

import type { getMessages } from "@/app/i18n"
import type { OusiaChatAttachmentSummary } from "@/electron/chat-types"
import type { ChatItem } from "@/features/chat/chat-events"
import { formatBytes } from "@/features/chat/chat-format"
import { CHAT_CONTENT_MAX_WIDTH_CLASS } from "@/features/chat/chat-layout"
import {
  CHAT_MESSAGE_INTRINSIC_BLOCK_SIZE_PROPERTY,
  CHAT_MESSAGE_MEASURED_ATTRIBUTE,
  formatMeasuredChatMessageBlockSize,
} from "@/features/chat/chat-message-containment"
import { ToolCallGroupView, ToolCallView } from "@/features/chat/ChatToolCall"
import { cn } from "@/lib/utils"

type ChatMessageListProps = {
  items: ChatItem[]
  isAgentWorking: boolean
  onBranchFromMessage: (itemId: string) => void
  onPreserveScrollAnchor: (element: HTMLElement) => void
  projectPath?: string
  sessionId?: string
  showTurnWaitIndicator: boolean
  t: ReturnType<typeof getMessages>
}

const STREAMDOWN_LINK_SAFETY = { enabled: false } as const
const ASSISTANT_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export const ChatMessageList = memo(function ChatMessageList({
  items,
  isAgentWorking,
  onBranchFromMessage,
  onPreserveScrollAnchor,
  projectPath,
  sessionId,
  showTurnWaitIndicator,
  t,
}: ChatMessageListProps) {
  const visibleItems = useMemo(
    () => items.filter(shouldRenderChatItem),
    [items],
  )
  const renderItems = useMemo(
    () => groupVisibleItems(visibleItems),
    [visibleItems],
  )
  const footerItemIds = useMemo(
    () => footerItemIdsForVisibleItems(visibleItems, isAgentWorking),
    [isAgentWorking, visibleItems],
  )

  return (
    <div className={CHAT_CONTENT_MAX_WIDTH_CLASS}>
      {renderItems.length ? (
        <>
          {renderItems.map((item, index) => (
            <MeasuredChatMessageContainer
              className={cn(
                chatRenderItemSpacingClass(item, renderItems[index - 1]),
                chatRenderItemRole(item) === "user" && "flex justify-end",
              )}
              key={chatRenderItemId(item)}
              role={chatRenderItemRole(item)}
            >
              <ChatItemView
                item={item}
                showAssistantFooter={
                  item.kind === "single" && footerItemIds.has(item.item.id)
                }
                onBranchFromMessage={onBranchFromMessage}
                onPreserveScrollAnchor={onPreserveScrollAnchor}
                projectPath={projectPath}
                sessionId={sessionId}
                t={t}
              />
            </MeasuredChatMessageContainer>
          ))}
          {showTurnWaitIndicator ? (
            <MeasuredChatMessageContainer
              className={chatWaitIndicatorSpacingClass(renderItems.at(-1))}
            >
              <AgentTurnWaitIndicator t={t} />
            </MeasuredChatMessageContainer>
          ) : null}
        </>
      ) : null}
    </div>
  )
})

function MeasuredChatMessageContainer({
  children,
  className,
  role,
}: {
  children: ReactNode
  className?: string
  role?: ChatItem["role"]
}) {
  const nodeRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const node = nodeRef.current
    if (!node) {
      throw new Error("Chat message containment mounted without its DOM node.")
    }
    if (typeof ResizeObserver === "undefined") {
      throw new Error("ResizeObserver is required for chat message containment.")
    }

    const updateMeasuredBlockSize = () => {
      const blockSize = node.getBoundingClientRect().height
      if (blockSize <= 0) {
        return
      }
      const formattedBlockSize =
        formatMeasuredChatMessageBlockSize(blockSize)
      if (
        node.style.getPropertyValue(
          CHAT_MESSAGE_INTRINSIC_BLOCK_SIZE_PROPERTY,
        ) === formattedBlockSize
      ) {
        return
      }
      node.style.setProperty(
        CHAT_MESSAGE_INTRINSIC_BLOCK_SIZE_PROPERTY,
        formattedBlockSize,
      )
      node.setAttribute(CHAT_MESSAGE_MEASURED_ATTRIBUTE, "true")
    }

    // The containment attribute is absent on first layout, so this reads the
    // fully rendered height rather than a guessed placeholder.
    updateMeasuredBlockSize()
    const resizeObserver = new ResizeObserver(updateMeasuredBlockSize)
    resizeObserver.observe(node)
    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <div
      ref={nodeRef}
      className={cn("ousia-chat-message-contain", className)}
      data-chat-message-role={role}
    >
      {children}
    </div>
  )
}

function shouldRenderChatItem(item: ChatItem) {
  return item.role !== "thinking" || item.status !== "finished"
}

function chatItemSpacingClass(item: ChatItem, previousItem?: ChatItem) {
  if (!previousItem) {
    return "mt-0"
  }

  if (item.role === "tool") {
    return previousItem.role === "tool"
      ? "mt-[var(--ousia-chat-spacing-tool-consecutive)]"
      : "mt-[var(--ousia-chat-spacing-before-tool)]"
  }

  if (previousItem.role === "tool") {
    return "mt-[var(--ousia-chat-spacing-after-tool)]"
  }

  if (item.role === "user" && previousItem.role === "assistant") {
    return "mt-[var(--ousia-chat-spacing-user-after-assistant)]"
  }

  return "mt-[var(--ousia-chat-spacing-default)]"
}

type ChatRenderItem =
  | { kind: "single"; item: ChatItem }
  | {
      kind: "toolGroup"
      id: string
      items: Extract<ChatItem, { role: "tool" }>[]
    }

function groupVisibleItems(items: ChatItem[]): ChatRenderItem[] {
  const grouped: ChatRenderItem[] = []
  let pendingTools: Extract<ChatItem, { role: "tool" }>[] = []

  const flushTools = () => {
    if (!pendingTools.length) {
      return
    }
    if (pendingTools.length === 1) {
      grouped.push({ kind: "single", item: pendingTools[0] })
    } else {
      grouped.push({
        kind: "toolGroup",
        id: `tool-group-${pendingTools[0].id}-${pendingTools.at(-1)?.id}`,
        items: pendingTools,
      })
    }
    pendingTools = []
  }

  items.forEach((item) => {
    if (item.role === "tool" && shouldGroupToolItem(item)) {
      pendingTools.push(item)
      return
    }
    flushTools()
    grouped.push({ kind: "single", item })
  })
  flushTools()

  return grouped
}

function shouldGroupToolItem(item: ChatItem) {
  if (item.role !== "tool") {
    return false
  }
  return false
}

function chatRenderItemSpacingClass(
  item: ChatRenderItem,
  previousItem?: ChatRenderItem,
) {
  return chatItemSpacingClass(
    chatRenderItemPrimaryItem(item),
    previousItem ? chatRenderItemPrimaryItem(previousItem) : undefined,
  )
}

function chatWaitIndicatorSpacingClass(previousItem?: ChatRenderItem) {
  if (!previousItem) {
    return "mt-0"
  }

  const previousPrimaryItem = chatRenderItemPrimaryItem(previousItem)
  return previousPrimaryItem.role === "tool" ? "mt-5" : "mt-6"
}

function chatRenderItemPrimaryItem(item: ChatRenderItem) {
  return item.kind === "single" ? item.item : item.items[0]
}

function chatRenderItemRole(item: ChatRenderItem) {
  return item.kind === "single" ? item.item.role : "tool"
}

function chatRenderItemId(item: ChatRenderItem) {
  return item.kind === "single" ? item.item.id : item.id
}

function footerItemIdsForVisibleItems(
  items: ChatItem[],
  isAgentWorking: boolean,
) {
  const footerItemIds = new Set<string>()
  let latestFinishedAssistantId: string | undefined

  items.forEach((item) => {
    if (
      item.role === "user" ||
      item.role === "system" ||
      item.role === "error"
    ) {
      if (latestFinishedAssistantId) {
        footerItemIds.add(latestFinishedAssistantId)
        latestFinishedAssistantId = undefined
      }
      return
    }

    if (item.role === "assistant") {
      if (item.status === "finished") {
        latestFinishedAssistantId = item.id
      }
      return
    }

    if (item.role === "tool") {
      latestFinishedAssistantId = undefined
      return
    }
  })

  const isCurrentRunCandidate =
    isAgentWorking && latestFinishedAssistantId === items.at(-1)?.id

  if (latestFinishedAssistantId && !isCurrentRunCandidate) {
    footerItemIds.add(latestFinishedAssistantId)
  }

  return footerItemIds
}

type ChatItemViewProps = {
  item: ChatRenderItem
  showAssistantFooter: boolean
  onBranchFromMessage: (itemId: string) => void
  onPreserveScrollAnchor: (element: HTMLElement) => void
  projectPath?: string
  sessionId?: string
  t: ReturnType<typeof getMessages>
}

const ChatItemView = memo(function ChatItemView({
  item,
  showAssistantFooter,
  onBranchFromMessage,
  onPreserveScrollAnchor,
  projectPath,
  sessionId,
  t,
}: ChatItemViewProps) {
  if (item.kind === "toolGroup") {
    return (
      <ToolCallGroupView
        items={item.items}
        onPreserveScrollAnchor={onPreserveScrollAnchor}
        projectPath={projectPath}
        sessionId={sessionId}
        t={t}
      />
    )
  }

  const chatItem = item.item
  if (chatItem.role === "thinking") {
    if (chatItem.status === "finished") {
      return null
    }

    return (
      <div className="border-border/70 text-muted-foreground/70 border-l py-1 pr-2 pl-3 text-xs leading-5 italic">
        {chatItem.text || t.chat.thinking}
      </div>
    )
  }

  if (chatItem.role === "tool") {
    return (
      <ToolCallView
        item={chatItem}
        onPreserveScrollAnchor={onPreserveScrollAnchor}
        projectPath={projectPath}
        sessionId={sessionId}
        t={t}
      />
    )
  }

  if (chatItem.role === "system" || chatItem.role === "error") {
    const isStreamingSystemMessage =
      chatItem.role === "system" && chatItem.status === "streaming"
    return (
      <div
        className={[
          "flex items-center gap-1.5 text-xs leading-5",
          chatItem.role === "error"
            ? "text-destructive"
            : "text-muted-foreground",
        ].join(" ")}
      >
        <span>{chatItem.text}</span>
        {isStreamingSystemMessage ? (
          <LoaderCircle
            size={13}
            className="text-muted-foreground/70 animate-spin"
          />
        ) : null}
      </div>
    )
  }

  return (
    <article
      className={[
        "group/message ousia-chat-message-text text-sm leading-5 select-text",
        chatItem.role === "user"
          ? "ousia-chat-user-message w-fit max-w-full rounded-xl px-3 py-2"
          : "text-foreground",
      ].join(" ")}
    >
      {chatItem.role === "assistant" ? (
        <Streamdown
          mode={chatItem.status === "streaming" ? "streaming" : "static"}
          animated
          isAnimating={chatItem.status === "streaming"}
          controls={false}
          linkSafety={STREAMDOWN_LINK_SAFETY}
          className="ousia-chat-markdown space-y-0 text-sm leading-5 break-words"
        >
          {chatItem.text}
        </Streamdown>
      ) : (
        <>
          {chatItem.attachments?.length ? (
            <MessageAttachmentList attachments={chatItem.attachments} />
          ) : null}
          {chatItem.text ? (
            <p className="m-0 break-words whitespace-pre-wrap">
              {chatItem.text}
            </p>
          ) : null}
          {chatItem.status === "failed" ? (
            <span className="text-destructive mt-1 flex items-center gap-1 text-[11px] leading-4">
              {t.chat.sendFailed}
            </span>
          ) : null}
        </>
      )}
      {showAssistantFooter ? (
        <AssistantMessageFooter
          item={chatItem}
          onBranchFromMessage={onBranchFromMessage}
          t={t}
        />
      ) : null}
    </article>
  )
}, areChatItemViewPropsEqual)

function areChatItemViewPropsEqual(
  previous: ChatItemViewProps,
  next: ChatItemViewProps,
) {
  if (
    previous.item.kind !== next.item.kind ||
    previous.showAssistantFooter !== next.showAssistantFooter ||
    previous.onPreserveScrollAnchor !== next.onPreserveScrollAnchor ||
    previous.projectPath !== next.projectPath ||
    previous.sessionId !== next.sessionId ||
    previous.t !== next.t
  ) {
    return false
  }

  const rendersAssistantFooter =
    next.showAssistantFooter &&
    next.item.kind === "single" &&
    next.item.item.role === "assistant"
  if (
    rendersAssistantFooter &&
    previous.onBranchFromMessage !== next.onBranchFromMessage
  ) {
    return false
  }

  return areChatRenderItemsEqual(previous.item, next.item)
}

function areChatRenderItemsEqual(left: ChatRenderItem, right: ChatRenderItem) {
  if (left.kind !== right.kind) {
    return false
  }
  if (left.kind === "single") {
    return right.kind === "single" && left.item === right.item
  }
  if (right.kind !== "toolGroup" || left.id !== right.id) {
    return false
  }
  return (
    left.items.length === right.items.length &&
    left.items.every((item, index) => item === right.items[index])
  )
}

function AssistantMessageFooter({
  item,
  onBranchFromMessage,
  t,
}: {
  item: ChatItem
  onBranchFromMessage: (itemId: string) => void
  t: ReturnType<typeof getMessages>
}) {
  if (item.role !== "assistant") {
    return null
  }
  const timeLabel = item.timestamp
    ? ASSISTANT_TIME_FORMATTER.format(new Date(item.timestamp))
    : ""

  return (
    <div className="text-muted-foreground/70 mt-2 flex h-5 items-center gap-1 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100">
      <button
        type="button"
        className="hover:bg-muted/60 hover:text-foreground flex size-4.5 items-center justify-center rounded-md"
        aria-label={t.chat.copyMessage}
        title={t.chat.copyMessage}
        onClick={() => {
          void navigator.clipboard?.writeText(item.text)
        }}
      >
        <Copy size={14} strokeWidth={1.5} />
      </button>
      {item.isPersisted ? (
        <button
          type="button"
          className="hover:bg-muted/60 hover:text-foreground flex size-4.5 items-center justify-center rounded-md"
          aria-label={t.chat.branchFromMessage}
          title={t.chat.branchFromMessage}
          onClick={() => onBranchFromMessage(item.id)}
        >
          <GitBranchPlus size={14} strokeWidth={1.5} />
        </button>
      ) : null}
      {timeLabel ? (
        <span
          className="ml-1 text-xs leading-none tabular-nums"
          style={{ fontFamily: "var(--font-sans-default)" }}
        >
          {timeLabel}
        </span>
      ) : null}
    </div>
  )
}

function MessageAttachmentList({
  attachments,
}: {
  attachments: OusiaChatAttachmentSummary[]
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const IconComponent = attachment.kind === "text" ? FileText : Paperclip
        return (
          <span
            key={attachment.id}
            className="border-foreground/8 bg-muted/15 text-muted-foreground inline-flex h-9 max-w-56 items-center gap-2 rounded-md border-[0.5px] px-2 text-xs dark:border-white/10 dark:bg-white/4"
            title={`${attachment.name} · ${formatBytes(attachment.size)}`}
          >
            {attachment.kind === "image" && attachment.dataBase64 ? (
              <img
                alt=""
                src={`data:${attachment.mediaType};base64,${attachment.dataBase64}`}
                className="size-6 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="bg-background/70 flex size-6 shrink-0 items-center justify-center rounded">
                {attachment.kind === "image" ? (
                  <FileImage size={16} strokeWidth={1.5} />
                ) : (
                  <IconComponent size={16} strokeWidth={1.5} />
                )}
              </span>
            )}
            <span className="min-w-0">
              <span className="text-foreground block truncate leading-4">
                {attachment.name}
              </span>
              <span className="text-muted-foreground block truncate text-[11px] leading-3">
                {formatBytes(attachment.size)}
              </span>
            </span>
          </span>
        )
      })}
    </div>
  )
}

function AgentTurnWaitIndicator({ t }: { t: ReturnType<typeof getMessages> }) {
  return (
    <div
      className="ousia-chat-message-text text-foreground flex min-h-5 items-center text-sm leading-5"
      aria-label={t.chat.waitingForNextStep}
      role="status"
    >
      <span className="inline-flex h-5 items-center gap-1 align-baseline">
        {[0, 1, 2].map((index) => (
          <span
            className="bg-muted-foreground/55 size-1.5 rounded-full motion-reduce:animate-none"
            key={index}
            style={{
              animation: "ousia-wave-dot 0.9s ease-in-out infinite",
              animationDelay: `${index * 0.12}s`,
            }}
          />
        ))}
      </span>
    </div>
  )
}
