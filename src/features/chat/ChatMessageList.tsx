import { memo } from "react"
import {
  Copy,
  FileImage,
  FileText,
  GitBranchPlus,
  Paperclip,
} from "@/components/icons/huge-icons"
import { Streamdown } from "streamdown"
import "streamdown/styles.css"

import type { getMessages } from "@/app/i18n"
import type { OusiaChatAttachmentSummary } from "@/electron/chat-types"
import type { ChatItem } from "@/features/chat/chat-events"
import { formatBytes } from "@/features/chat/chat-format"
import { CHAT_CONTENT_MAX_WIDTH_CLASS } from "@/features/chat/chat-layout"
import { ToolCallView } from "@/features/chat/ChatToolCall"
import { cn } from "@/lib/utils"

type ChatMessageListProps = {
  items: ChatItem[]
  onBranchFromMessage: (itemId: string) => void
  showTurnWaitIndicator: boolean
  t: ReturnType<typeof getMessages>
}

export const ChatMessageList = memo(function ChatMessageList({
  items,
  onBranchFromMessage,
  showTurnWaitIndicator,
  t,
}: ChatMessageListProps) {
  return (
    <div className={cn(CHAT_CONTENT_MAX_WIDTH_CLASS, "space-y-6")}>
      {items.length ? (
        <>
          {items.map((item) => (
            <ChatItemView
              item={item}
              key={item.id}
              onBranchFromMessage={onBranchFromMessage}
              t={t}
            />
          ))}
          {showTurnWaitIndicator ? <AgentTurnWaitIndicator t={t} /> : null}
        </>
      ) : null}
    </div>
  )
})

const ChatItemView = memo(function ChatItemView({
  item,
  onBranchFromMessage,
  t,
}: {
  item: ChatItem
  onBranchFromMessage: (itemId: string) => void
  t: ReturnType<typeof getMessages>
}) {
  if (item.role === "thinking") {
    if (item.status === "finished") {
      return null
    }

    return (
      <div className="border-l border-border/70 py-1 pr-2 pl-3 text-xs leading-5 text-muted-foreground/70 italic">
        {item.text || t.chat.thinking}
      </div>
    )
  }

  if (item.role === "tool") {
    return <ToolCallView item={item} t={t} />
  }

  if (item.role === "system" || item.role === "error") {
    return (
      <div
        className={[
          "text-xs leading-5",
          item.role === "error" ? "text-destructive" : "text-muted-foreground",
        ].join(" ")}
      >
        {item.text}
      </div>
    )
  }

  return (
    <article
      className={[
        "group/message ousia-chat-message-text select-text text-sm leading-5",
        item.role === "user"
          ? "ousia-squircle-corners ml-auto w-fit rounded-[18px] bg-card px-3 py-2 text-card-foreground"
          : "text-foreground",
      ].join(" ")}
    >
      {item.role === "assistant" ? (
        <Streamdown
          mode={item.status === "streaming" ? "streaming" : "static"}
          isAnimating={item.status === "streaming"}
          linkSafety={{ enabled: false }}
          className="ousia-chat-markdown space-y-0 text-sm leading-5 break-words"
        >
          {item.text}
        </Streamdown>
      ) : (
        <>
          {item.attachments?.length ? (
            <MessageAttachmentList attachments={item.attachments} />
          ) : null}
          {item.text ? (
            <p className="m-0 break-words whitespace-pre-wrap">{item.text}</p>
          ) : null}
        </>
      )}
      {item.role === "assistant" && item.status === "finished" ? (
        <AssistantMessageFooter
          item={item}
          onBranchFromMessage={onBranchFromMessage}
          t={t}
        />
      ) : null}
    </article>
  )
})

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
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(item.timestamp))
    : ""

  return (
    <div className="mt-2 flex h-5 items-center gap-1.5 text-muted-foreground/70 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
      <button
        type="button"
        className="flex size-5 items-center justify-center rounded-md hover:bg-muted/60 hover:text-foreground"
        aria-label={t.chat.copyMessage}
        title={t.chat.copyMessage}
        onClick={() => {
          void navigator.clipboard?.writeText(item.text)
        }}
      >
        <Copy size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        className="flex size-5 items-center justify-center rounded-md hover:bg-muted/60 hover:text-foreground"
        aria-label={t.chat.branchFromMessage}
        title={t.chat.branchFromMessage}
        onClick={() => onBranchFromMessage(item.id)}
      >
        <GitBranchPlus size={16} strokeWidth={1.5} />
      </button>
      {timeLabel ? (
        <span className="text-xs leading-none tabular-nums">{timeLabel}</span>
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
            className="inline-flex h-9 max-w-56 items-center gap-2 rounded-md border-[0.5px] border-foreground/8 bg-muted/15 px-2 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/4"
            title={`${attachment.name} · ${formatBytes(attachment.size)}`}
          >
            {attachment.kind === "image" && attachment.dataBase64 ? (
              <img
                alt=""
                src={`data:${attachment.mediaType};base64,${attachment.dataBase64}`}
                className="size-6 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-background/70">
                {attachment.kind === "image" ? (
                  <FileImage size={16} strokeWidth={1.5} />
                ) : (
                  <IconComponent size={16} strokeWidth={1.5} />
                )}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate leading-4 text-foreground">
                {attachment.name}
              </span>
              <span className="block truncate text-[11px] leading-3 text-muted-foreground">
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
      className="flex min-h-10 items-start px-2 pt-1"
      aria-label={t.chat.waitingForNextStep}
      role="status"
    >
      <span className="flex h-5 items-center gap-1">
        {[0, 1, 2].map((index) => (
          <span
            className="size-1.5 rounded-full bg-muted-foreground/55 motion-reduce:animate-none"
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
