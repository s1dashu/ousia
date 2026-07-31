import type { MouseEvent } from "react"

export function handleTextButtonMouseDown(
  event: MouseEvent<HTMLButtonElement>
) {
  event.preventDefault()
}

export const sidebarAddIconSize = 18
export const sidebarFolderIconSize = 18
export const sidebarMenuIconSize = 18
export const sidebarMenuIconXClass = "-translate-x-0.5"
export const sidebarSectionIconSize = 14
export const sidebarIconStrokeWidth = 1.5
export const sidebarActionButtonClass = "size-6 justify-self-end"
export const sidebarSingleActionGridClass = "grid-cols-[minmax(0,1fr)_24px]"
export const sidebarProjectActionButtonClass = "size-6 justify-self-end"
export const sidebarProjectLeadGridClass =
  "grid-cols-[24px_minmax(0,1fr)_24px_24px]"
export const sidebarProjectSessionGridClass =
  "grid-cols-[24px_minmax(0,1fr)_24px]"
export const sidebarScrollPaddingXClass = "px-2"
export const sidebarFooterPaddingXClass = "px-[7px]"
export const sidebarRowFrameXClass = "w-full"
export const sidebarRowLeadingInsetClass = "pl-3"
export const sidebarRowContentXClass = `${sidebarRowLeadingInsetClass} pr-2`
export const sidebarRowXClass = `${sidebarRowFrameXClass} ${sidebarRowContentXClass}`
export const sidebarSessionRowXClass = `mr-1 ${sidebarRowLeadingInsetClass} pr-1`
export const sidebarSessionDragPreviewXClass = "px-3"
export const sidebarRightActionRowXClass = `${sidebarRowFrameXClass} ${sidebarRowLeadingInsetClass} pr-1`
export const sidebarProjectRowXClass = sidebarRightActionRowXClass
export const sidebarListGapClass = "flex flex-col gap-0.5"
export const sidebarSectionHeaderXClass = sidebarRightActionRowXClass
export const sidebarEmptySectionRowXClass = sidebarSessionRowXClass
export const sidebarDefaultSessionPreviewCount = 10
export const sidebarProjectSessionCompactCount = 5
export const sidebarProjectSessionPreviewCount = 10
export const sidebarScrollRevealPadding = 12
export const sidebarRowStateClass =
  "text-sidebar-accent-foreground hover:bg-[var(--sidebar-accent)]"
export const sidebarProjectRowStateClass =
  "relative text-sidebar-accent-foreground before:pointer-events-none before:absolute before:inset-0 before:rounded-md before:bg-transparent hover:before:bg-[var(--sidebar-accent)] focus-within:before:bg-[var(--sidebar-accent)] [&>*]:relative [&>*]:z-[1]"
export const sidebarSelectedRowClass =
  "bg-white text-sidebar-accent-foreground shadow-[var(--ousia-sidebar-selected-shadow)] dark:bg-card"
export const sidebarActionHoverClass =
  "hover:bg-muted hover:text-sidebar-accent-foreground"
export const sidebarDragPlaceholderClass =
  "!bg-neutral-500/12 !text-transparent !shadow-none hover:!bg-neutral-500/12 focus-within:!bg-neutral-500/12 dark:!bg-white/10 dark:!text-transparent dark:hover:!bg-white/10 dark:focus-within:!bg-white/10 [&>*]:opacity-0"
export const sidebarCompletionAccentClass = "bg-blue-500"
export const sidebarDragOverlayZIndex = 1000
