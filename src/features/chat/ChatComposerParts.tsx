import {
  FileText,
  GripVertical,
  Paperclip,
  Pencil,
  SendHorizontal,
  Trash2,
  X,
} from "@/components/icons/nucleo-icons"

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
  readOnly = false,
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
  readOnly?: boolean
  t: ReturnType<typeof getMessages>
}) {
  return (
    <div className="ousia-squircle-corners rounded-t-[var(--ousia-chat-composer-radius)] rounded-b-none border-[0.5px] border-foreground/10 bg-white px-2.5 pt-2.5 pb-10 shadow-[0_6px_22px_rgba(0,0,0,0.035),0_1px_8px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,0.42)] dark:border-foreground/10 dark:bg-card dark:shadow-[0_6px_22px_rgba(0,0,0,0.18),0_1px_8px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="space-y-1.5">
        {messages.map((message, index) => (
          <div
            key={message.id}
            draggable={!readOnly}
            onDragStart={(event) => {
              if (readOnly) {
                return
              }
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData("text/plain", message.id)
              onDragStart(message.id)
            }}
            onDragOver={(event) => {
              if (readOnly) {
                return
              }
              event.preventDefault()
              const activeId =
                draggingId || event.dataTransfer.getData("text/plain")
              if (activeId) {
                onDragOver(activeId, message.id)
              }
            }}
            onDrop={(event) => {
              if (readOnly) {
                return
              }
              event.preventDefault()
              onDragEnd()
            }}
            onDragEnd={readOnly ? undefined : onDragEnd}
            className={cn(
              "flex h-8 min-w-0 items-center gap-2 rounded-2xl bg-muted/35 px-2.5 text-xs text-muted-foreground",
              draggingId === message.id && "opacity-50",
              editingId === message.id && "bg-ring/12 text-foreground"
            )}
          >
            {readOnly ? null : (
              <GripVertical
                size={14}
                strokeWidth={1.5}
                className="shrink-0 cursor-grab"
              />
            )}
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
            {readOnly ? null : (
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.chat.sendNow}
                  className="size-5 rounded-md text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                  onClick={() => onSendNow(message.id)}
                >
                  <SendHorizontal size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.app.edit}
                  className="size-5 rounded-md text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                  onClick={() => onEdit(message.id)}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.app.delete}
                  className="size-5 rounded-md text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                  onClick={() => onDelete(message.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            )}
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
    <div className="ousia-hover-scrollbar mb-2 flex max-h-28 flex-wrap gap-2 overflow-auto pr-1.5">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group flex h-12 max-w-56 items-center gap-2 rounded-md border-[0.5px] border-foreground/8 bg-muted/15 px-2 transition-colors hover:border-foreground/12 hover:bg-muted/25 dark:border-white/10 dark:bg-white/4 dark:hover:border-white/14 dark:hover:bg-white/6"
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
                <Paperclip size={18} strokeWidth={1.5} />
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
            className="size-6 shrink-0 text-muted-foreground/80 hover:bg-transparent hover:text-foreground"
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
