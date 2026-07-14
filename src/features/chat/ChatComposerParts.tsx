import {
  FileText,
  GripVertical,
  Paperclip,
  Pencil,
  SendHorizontal,
  Trash2,
  X,
} from "@/components/icons/huge-icons"
import type { Ref } from "react"

import type { getMessages } from "@/app/i18n"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import type { OusiaChatAttachment } from "@/electron/chat-types"
import { formatBytes } from "@/features/chat/chat-format"
import { cn } from "@/lib/utils"

export const CHAT_COMPOSER_INPUT_CLASS =
  "ousia-chat-composer-input ousia-hover-scrollbar -mr-4 [field-sizing:fixed] min-h-12 w-[calc(100%+1rem)] resize-none rounded-none border-0 bg-transparent py-0 pr-2 pl-0 text-sm leading-6 shadow-none placeholder:text-muted-foreground/55 focus-visible:ring-0 dark:bg-transparent"

export const CHAT_COMPOSER_SHELL_CLASS = "relative z-30 shrink-0 bg-card pb-4"

export const CHAT_QUEUE_OVERLAY_CLASS =
  "ousia-hover-scrollbar absolute inset-x-5 bottom-[calc(100%-2rem)] z-0 max-h-[min(50vh,24rem)] overflow-y-auto overscroll-contain"

export type QueuedChatMessage = {
  id: string
  text: string
  attachments: OusiaChatAttachment[]
}

export function QueuedMessageList({
  className,
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
  rootRef,
  t,
}: {
  className?: string
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
  rootRef?: Ref<HTMLDivElement>
  t: ReturnType<typeof getMessages>
}) {
  return (
    <div
      ref={rootRef}
      className={cn(
        "border-foreground/10 bg-card rounded-t-[var(--ousia-chat-composer-radius)] rounded-b-none border-[0.5px] px-2.5 pt-2.5 pb-10 shadow-[0_6px_22px_rgba(0,0,0,0.035),0_1px_8px_rgba(0,0,0,0.02),inset_0_1px_0_rgba(255,255,255,0.42)] dark:shadow-[0_6px_22px_rgba(0,0,0,0.18),0_1px_8px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.035)]",
        className,
      )}
    >
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
              "bg-muted/35 text-muted-foreground flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-xs",
              draggingId === message.id && "opacity-50",
              editingId === message.id && "bg-ring/12 text-foreground",
            )}
          >
            {readOnly ? null : (
              <GripVertical
                size={14}
                strokeWidth={1.5}
                className="shrink-0 cursor-grab"
              />
            )}
            <span className="text-muted-foreground/75 shrink-0 tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {queuedMessageLabel(message)}
            </span>
            {message.attachments.length ? (
              <span className="text-muted-foreground/75 shrink-0">
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
                  className="text-muted-foreground hover:text-foreground size-5 rounded-md [&_svg]:size-3.5"
                  onClick={() => onSendNow(message.id)}
                >
                  <SendHorizontal size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.app.edit}
                  className="text-muted-foreground hover:text-foreground size-5 rounded-md [&_svg]:size-3.5"
                  onClick={() => onEdit(message.id)}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t.app.delete}
                  className="text-muted-foreground hover:text-foreground size-5 rounded-md [&_svg]:size-3.5"
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
        <Attachment key={attachment.id} className="w-64 flex-nowrap">
          <AttachmentMedia
            variant={attachment.kind === "image" ? "image" : "icon"}
          >
            {attachment.kind === "image" ? (
              <img
                alt=""
                src={`data:${attachment.mediaType};base64,${attachment.dataBase64}`}
              />
            ) : attachment.kind === "text" ? (
              <FileText />
            ) : (
              <Paperclip />
            )}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{attachment.name}</AttachmentTitle>
            <AttachmentDescription>
              {formatBytes(attachment.size)}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              type="button"
              aria-label={t.chat.removeAttachment(attachment.name)}
              onClick={() => onRemove(attachment.id)}
            >
              <X />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
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
