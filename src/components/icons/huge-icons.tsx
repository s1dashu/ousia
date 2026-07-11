/* eslint-disable react-refresh/only-export-components */
import type { SVGProps } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon"
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import ArrowDown02Icon from "@hugeicons/core-free-icons/ArrowDown02Icon"
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon"
import ArrowShrinkIcon from "@hugeicons/core-free-icons/ArrowShrinkIcon"
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon"
import ArrowUpIcon from "@hugeicons/core-free-icons/ArrowUp01Icon"
import BanIcon from "@hugeicons/core-free-icons/BanIcon"
import BubbleChatIcon from "@hugeicons/core-free-icons/BubbleChatIcon"
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import ChatAdd01Icon from "@hugeicons/core-free-icons/ChatAdd01Icon"
import CheckIcon from "@hugeicons/core-free-icons/CheckIcon"
import CheckmarkCircleIcon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon"
import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon"
import ChevronRightIcon from "@hugeicons/core-free-icons/ChevronRightIcon"
import ChevronUpIcon from "@hugeicons/core-free-icons/ChevronUpIcon"
import ClockIcon from "@hugeicons/core-free-icons/Clock01Icon"
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon"
import ComputerTerminalIcon from "@hugeicons/core-free-icons/ComputerTerminal01Icon"
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon"
import DatabaseIcon from "@hugeicons/core-free-icons/DatabaseIcon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import EyeIcon from "@hugeicons/core-free-icons/EyeIcon"
import EyeOffIcon from "@hugeicons/core-free-icons/EyeOffIcon"
import File01Icon from "@hugeicons/core-free-icons/File01Icon"
import HugeFileImageIcon from "@hugeicons/core-free-icons/FileImageIcon"
import FileScriptIcon from "@hugeicons/core-free-icons/FileScriptIcon"
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon"
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon"
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon"
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon"
import GripVerticalIcon from "@hugeicons/core-free-icons/GripVerticalIcon"
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon"
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon"
import PanelLeftIcon from "@hugeicons/core-free-icons/PanelLeftIcon"
import PaintBrush01Icon from "@hugeicons/core-free-icons/PaintBrush01Icon"
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import SentIcon from "@hugeicons/core-free-icons/SentIcon"
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon"
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon"
import SplitIcon from "@hugeicons/core-free-icons/SplitIcon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon"
import Unlink05Icon from "@hugeicons/core-free-icons/Unlink05Icon"

import { cn } from "@/lib/utils"

export type HugeIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number | string
  strokeWidth?: number | string
}

function normalizeStrokeWidth(strokeWidth: HugeIconProps["strokeWidth"]) {
  if (strokeWidth === undefined) {
    return undefined
  }

  const numericStrokeWidth =
    typeof strokeWidth === "number" ? strokeWidth : Number(strokeWidth)

  return Number.isFinite(numericStrokeWidth) ? numericStrokeWidth : undefined
}

function createHugeIcon(icon: IconSvgElement) {
  return function HugeIcon({
    className,
    size = 18,
    strokeWidth,
    style,
    ...props
  }: HugeIconProps) {
    return (
      <HugeiconsIcon
        aria-hidden="true"
        className={cn("inline-block shrink-0", className)}
        icon={icon}
        role="img"
        size={size}
        strokeWidth={normalizeStrokeWidth(strokeWidth)}
        style={{ color: "currentColor", ...style }}
        {...props}
      />
    )
  }
}

export const ArrowDown = createHugeIcon(ArrowDown01Icon)
export const ArrowLeft = createHugeIcon(ArrowLeft02Icon)
export const ArrowShrink = createHugeIcon(ArrowShrinkIcon)
export const ArrowUp = createHugeIcon(ArrowUpIcon)
export const SendArrowDown = createHugeIcon(ArrowDown02Icon)
export const SendArrowUp = createHugeIcon(ArrowUp02Icon)
export const Ban = createHugeIcon(BanIcon)
export const Branch = createHugeIcon(GitBranchIcon)
export const BubbleChat = createHugeIcon(BubbleChatIcon)
export const ChatPlus = createHugeIcon(ChatAdd01Icon)
export const Check = createHugeIcon(CheckIcon)
export const ChevronDown = createHugeIcon(ChevronDownIcon)
export const ChevronRight = createHugeIcon(ChevronRightIcon)
export const ChevronUp = createHugeIcon(ChevronUpIcon)
export const CircleAlert = createHugeIcon(AlertCircleIcon)
export const CircleCheck = createHugeIcon(CheckmarkCircleIcon)
export const Clock = createHugeIcon(ClockIcon)
export const Code = createHugeIcon(CodeIcon)
export const Copy = createHugeIcon(Copy01Icon)
export const Database = createHugeIcon(DatabaseIcon)
export const Eye = createHugeIcon(EyeIcon)
export const EyeOff = createHugeIcon(EyeOffIcon)
export const File = createHugeIcon(File01Icon)
export const FileImage = createHugeIcon(HugeFileImageIcon)
export const FileText = createHugeIcon(FileScriptIcon)
export const Folder = createHugeIcon(Folder01Icon)
export const FolderOpen = createHugeIcon(Folder02Icon)
export const FolderPlus = createHugeIcon(FolderAddIcon)
export const GitBranchPlus = createHugeIcon(SplitIcon)
export const GripVertical = createHugeIcon(GripVerticalIcon)
export const LoaderCircle = createHugeIcon(Loading03Icon)
export const MoreHorizontal = createHugeIcon(MoreHorizontalIcon)
export const PanelLeft = createHugeIcon(PanelLeftIcon)
export const PaintBrush = createHugeIcon(PaintBrush01Icon)
export const Paperclip = createHugeIcon(Unlink05Icon)
export const Pencil = createHugeIcon(PencilEdit02Icon)
export const Plus = createHugeIcon(PlusSignIcon)
export const Search = createHugeIcon(Search01Icon)
export const SendHorizontal = createHugeIcon(SentIcon)
export const Settings = createHugeIcon(Settings02Icon)
export function SlidersHorizontal({
  className,
  size = 18,
  strokeWidth = 1.7,
  style,
  ...props
}: HugeIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={cn("inline-block shrink-0", className)}
      fill="none"
      height={size}
      role="img"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      style={{ color: "currentColor", ...style }}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <path d="M4 8h8" />
      <path d="M16 8h4" />
      <path d="M4 16h4" />
      <path d="M12 16h8" />
      <circle cx="14" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </svg>
  )
}
export const Sparkles = createHugeIcon(SparklesIcon)
export const SquareTerminal = createHugeIcon(ComputerTerminalIcon)
export const Terminal = SquareTerminal
export const Trash2 = createHugeIcon(Delete02Icon)
export const X = createHugeIcon(Cancel01Icon)
export const Tick = createHugeIcon(Tick02Icon)
export const UnfoldMore = createHugeIcon(UnfoldMoreIcon)
