import { FileImage, FileText, Paperclip } from "lucide-react"
import { Streamdown } from "streamdown"
import "streamdown/styles.css"

import type { getMessages } from "@/app/i18n"
import type { OusiaChatAttachment } from "@/electron/chat-types"
import type { ChatItem } from "@/features/chat/chat-events"
import { formatBytes } from "@/features/chat/chat-format"
import { CHAT_CONTENT_MAX_WIDTH_CLASS } from "@/features/chat/chat-layout"
import { ToolCallView } from "@/features/chat/ChatToolCall"
import { cn } from "@/lib/utils"

type ChatAttachmentSummary = Pick<
  OusiaChatAttachment,
  "id" | "kind" | "mediaType" | "name" | "size"
>

type ChatMessageListProps = {
  items: ChatItem[]
  showTurnWaitIndicator: boolean
  t: ReturnType<typeof getMessages>
}

export function ChatMessageList({
  items,
  showTurnWaitIndicator,
  t,
}: ChatMessageListProps) {
  return (
    <div className={cn(CHAT_CONTENT_MAX_WIDTH_CLASS, "space-y-5")}>
      {items.length ? (
        <>
          {items.map((item) => (
            <ChatItemView item={item} key={item.id} t={t} />
          ))}
          {showTurnWaitIndicator ? <AgentTurnWaitIndicator t={t} /> : null}
        </>
      ) : null}
    </div>
  )
}

function ChatItemView({
  item,
  t,
}: {
  item: ChatItem
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
        "select-text text-sm leading-5",
        item.role === "user"
          ? "ml-auto w-fit rounded-lg bg-card px-3 py-2 text-card-foreground"
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
    </article>
  )
}

function MessageAttachmentList({
  attachments,
}: {
  attachments: ChatAttachmentSummary[]
}) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const IconComponent =
          attachment.kind === "image"
            ? FileImage
            : attachment.kind === "text"
              ? FileText
              : Paperclip
        return (
          <span
            key={attachment.id}
            className="inline-flex max-w-52 items-center gap-1.5 rounded-md border bg-background/80 px-2 py-1 text-xs text-muted-foreground"
            title={`${attachment.name} · ${formatBytes(attachment.size)}`}
          >
            <IconComponent size={14} className="shrink-0" />
            <span className="truncate">{attachment.name}</span>
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
