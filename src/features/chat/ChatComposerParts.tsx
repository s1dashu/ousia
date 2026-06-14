import {
  File,
  FileText,
  GripVertical,
  Pencil,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react"

import type { getMessages } from "@/app/i18n"
import { Button } from "@/components/ui/button"
import type { OusiaChatAttachment } from "@/electron/chat-types"
import { formatBytes } from "@/features/chat/chat-format"
import { cn } from "@/lib/utils"

export type QueuedChatMessage = {
  id: string
  text: string
  attachments: OusiaChatAttachment[]
}

export function QueuedMessageList({
  editingId,
  draggingId,
  messages,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onEdit,
  onSendNow,
  t,
}: {
  editingId: string | null
  draggingId: string | null
  messages: QueuedChatMessage[]
  onDelete: (id: string) => void
  onDragEnd: () => void
  onDragOver: (activeId: string, overId: string) => void
  onDragStart: (id: string) => void
  onEdit: (id: string) => void
  onSendNow: (id: string) => void
  t: ReturnType<typeof getMessages>
}) {
  return (
    <div className="mx-3 mb-1 rounded-t-xl border border-b-0 border-border/80 bg-popover px-2 pt-2 pb-1.5">
      <div className="space-y-1.5">
        {messages.map((message, index) => (
          <div
            key={message.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData("text/plain", message.id)
              onDragStart(message.id)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              const activeId =
                draggingId || event.dataTransfer.getData("text/plain")
              if (activeId) {
                onDragOver(activeId, message.id)
              }
            }}
            onDrop={(event) => {
              event.preventDefault()
              onDragEnd()
            }}
            onDragEnd={onDragEnd}
            className={cn(
              "flex h-8 min-w-0 items-center gap-2 rounded-md bg-muted/45 px-2 text-xs text-muted-foreground",
              draggingId === message.id && "opacity-50",
              editingId === message.id && "bg-ring/15 text-foreground"
            )}
          >
            <GripVertical
              size={18}
              strokeWidth={1.5}
              className="shrink-0 cursor-grab"
            />
            <span className="shrink-0 tabular-nums text-muted-foreground/75">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {queuedMessageLabel(message)}
            </span>
            {message.attachments.length ? (
              <span className="shrink-0 text-muted-foreground/75">
                {t.chat.attachmentCount(message.attachments.length)}
              </span>
            ) : null}
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.chat.sendNow}
                className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => onSendNow(message.id)}
              >
                <SendHorizontal size={18} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.app.edit}
                className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => onEdit(message.id)}
              >
                <Pencil size={18} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t.app.delete}
                className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                onClick={() => onDelete(message.id)}
              >
                <Trash2 size={18} />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AttachmentStrip({
  attachments,
  onRemove,
  t,
}: {
  attachments: OusiaChatAttachment[]
  onRemove: (id: string) => void
  t: ReturnType<typeof getMessages>
}) {
  return (
    <div className="mb-2 flex max-h-28 flex-wrap gap-2 overflow-auto pr-1">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group flex h-12 max-w-56 items-center gap-2 rounded-md border bg-muted/25 px-2"
        >
          {attachment.kind === "image" ? (
            <img
              alt=""
              src={`data:${attachment.mediaType};base64,${attachment.dataBase64}`}
              className="size-8 shrink-0 rounded object-cover"
            />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded bg-background text-muted-foreground">
              {attachment.kind === "text" ? (
                <FileText size={18} strokeWidth={1.5} />
              ) : (
                <File size={18} strokeWidth={1.5} />
              )}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs leading-4">
              {attachment.name}
            </span>
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
              {formatBytes(attachment.size)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0 text-muted-foreground"
            aria-label={t.chat.removeAttachment(attachment.name)}
            onClick={() => onRemove(attachment.id)}
          >
            <X size={18} />
          </Button>
        </div>
      ))}
    </div>
  )
}

function queuedMessageLabel(message: QueuedChatMessage) {
  if (message.text) {
    return message.text
  }
  return message.attachments.map((attachment) => attachment.name).join(", ")
}
