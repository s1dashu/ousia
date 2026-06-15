/* eslint-disable react-refresh/only-export-components */
import type { SVGProps } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  Cancel01Icon,
  CheckIcon,
  CheckmarkCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  CodeIcon,
  ComputerTerminalIcon,
  Copy01Icon,
  DatabaseIcon,
  Delete02Icon,
  EyeIcon,
  EyeOffIcon,
  File01Icon,
  FileImageIcon as HugeFileImageIcon,
  FileScriptIcon,
  Folder01Icon,
  Folder02Icon,
  GitBranchIcon,
  GripVerticalIcon,
  Loading03Icon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  SentIcon,
  Settings02Icon,
  SparklesIcon,
  SplitIcon,
  Tick02Icon,
  Unlink05Icon,
} from "@hugeicons/core-free-icons"

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

export const ArrowDown = createHugeIcon(ArrowDownIcon)
export const ArrowUp = createHugeIcon(ArrowUpIcon)
export const Branch = createHugeIcon(GitBranchIcon)
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
export const GitBranchPlus = createHugeIcon(SplitIcon)
export const GripVertical = createHugeIcon(GripVerticalIcon)
export const LoaderCircle = createHugeIcon(Loading03Icon)
export const MoreHorizontal = createHugeIcon(MoreHorizontalIcon)
export const PanelLeft = createHugeIcon(PanelLeftIcon)
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
