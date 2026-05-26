import {
  ChartSquareBoldDuotone,
  ChecklistBoldDuotone,
  CodeSquareBoldDuotone,
  DocumentTextBoldDuotone,
  FigmaBoldDuotone,
  GalleryBoldDuotone,
  GlobalBoldDuotone,
  MonitorBoldDuotone,
  Sun2BoldDuotone,
  UserCircleBoldDuotone,
  WidgetBoldDuotone,
  Widget6BoldDuotone,
} from "solar-icon-set"

import browserIcon from "@/assets/extension-icons/browser.png"
import browserLightIcon from "@/assets/extension-icons/browser-light.png"
import editorIcon from "@/assets/extension-icons/editor.png"
import editorLightIcon from "@/assets/extension-icons/editor-light.png"
import excalidrawIcon from "@/assets/extension-icons/excalidraw.png"
import excalidrawLightIcon from "@/assets/extension-icons/excalidraw-light.png"
import pdfEditorIcon from "@/assets/extension-icons/pdf-editor.png"
import pdfEditorLightIcon from "@/assets/extension-icons/pdf-editor-light.png"
import sheetsIcon from "@/assets/extension-icons/sheets.png"
import sheetsLightIcon from "@/assets/extension-icons/sheets-light.png"
import terminalIcon from "@/assets/extension-icons/terminal.png"
import terminalLightIcon from "@/assets/extension-icons/terminal-light.png"

const extensionIconImages = {
  "extension.firstParty.browser": {
    dark: browserIcon,
    light: browserLightIcon,
  },
  "extension.firstParty.editor": {
    dark: editorIcon,
    light: editorLightIcon,
  },
  "extension.firstParty.terminal": {
    dark: terminalIcon,
    light: terminalLightIcon,
  },
  "extension.firstParty.pdfEditor": {
    dark: pdfEditorIcon,
    light: pdfEditorLightIcon,
  },
  "extension.firstParty.excalidraw": {
    dark: excalidrawIcon,
    light: excalidrawLightIcon,
  },
  "extension.firstParty.univerSheets": {
    dark: sheetsIcon,
    light: sheetsLightIcon,
  },
}

const extensionIcons = {
  "anime-grid": GalleryBoldDuotone,
  dashboard: ChartSquareBoldDuotone,
  "dashboard-2": ChartSquareBoldDuotone,
  profile: UserCircleBoldDuotone,
  todo: ChecklistBoldDuotone,
  weather: Sun2BoldDuotone,
  "extension.firstParty.browser": GlobalBoldDuotone,
  "extension.firstParty.editor": CodeSquareBoldDuotone,
  "extension.firstParty.terminal": MonitorBoldDuotone,
  "extension.firstParty.pdfEditor": DocumentTextBoldDuotone,
  "extension.firstParty.excalidraw": FigmaBoldDuotone,
  "extension.firstParty.univerSheets": ChartSquareBoldDuotone,
}

const extensionIconClasses = {
  "anime-grid":
    "bg-[linear-gradient(145deg,hsl(322_82%_67%),hsl(262_76%_55%))] text-white dark:shadow-[0_10px_24px_hsl(282_74%_42%/0.24)]",
  dashboard:
    "bg-[linear-gradient(145deg,hsl(221_83%_60%),hsl(258_78%_52%))] text-white dark:shadow-[0_10px_24px_hsl(238_74%_42%/0.24)]",
  "dashboard-2":
    "bg-[linear-gradient(145deg,hsl(221_83%_60%),hsl(258_78%_52%))] text-white dark:shadow-[0_10px_24px_hsl(238_74%_42%/0.24)]",
  profile:
    "bg-[linear-gradient(145deg,hsl(33_90%_58%),hsl(356_78%_58%))] text-white dark:shadow-[0_10px_24px_hsl(12_76%_42%/0.24)]",
  todo:
    "bg-[linear-gradient(145deg,hsl(48_92%_58%),hsl(28_88%_52%))] text-white dark:shadow-[0_10px_24px_hsl(34_86%_42%/0.24)]",
  weather:
    "bg-[linear-gradient(145deg,hsl(199_88%_58%),hsl(48_94%_58%))] text-white dark:shadow-[0_10px_24px_hsl(196_78%_42%/0.22)]",
  "extension.firstParty.browser":
    "bg-[linear-gradient(145deg,hsl(202_90%_62%),hsl(219_82%_48%))] text-white dark:shadow-[0_10px_24px_hsl(217_80%_36%/0.24)]",
  "extension.firstParty.editor":
    "bg-[linear-gradient(145deg,hsl(158_68%_55%),hsl(185_86%_39%))] text-white dark:shadow-[0_10px_24px_hsl(182_72%_32%/0.22)]",
  "extension.firstParty.terminal":
    "bg-[linear-gradient(145deg,hsl(248_22%_22%),hsl(220_18%_10%))] text-white dark:shadow-[0_10px_24px_hsl(220_18%_10%/0.28)]",
  "extension.firstParty.pdfEditor":
    "bg-[linear-gradient(145deg,hsl(354_84%_60%),hsl(28_90%_52%))] text-white dark:shadow-[0_10px_24px_hsl(10_78%_42%/0.22)]",
  "extension.firstParty.excalidraw":
    "bg-[linear-gradient(145deg,hsl(259_88%_66%),hsl(318_82%_62%))] text-white dark:shadow-[0_10px_24px_hsl(282_74%_42%/0.22)]",
  "extension.firstParty.univerSheets":
    "bg-[linear-gradient(145deg,hsl(146_64%_45%),hsl(176_72%_36%))] text-white dark:shadow-[0_10px_24px_hsl(160_68%_32%/0.22)]",
}

function getExtensionIconKey(extensionId: string) {
  if (extensionId.startsWith("extension.userLocal.")) {
    return extensionId.slice("extension.userLocal.".length).split(".")[0]
  }
  return extensionId
}

export function getWorkspaceExtensionIconImages(
  extensionId: string | null | undefined
) {
  if (!extensionId) {
    return undefined
  }
  const iconKey = getExtensionIconKey(extensionId)
  return extensionIconImages[iconKey as keyof typeof extensionIconImages]
}

export function getWorkspaceExtensionIcon(extensionId: string | null | undefined) {
  if (!extensionId) {
    return WidgetBoldDuotone
  }
  const iconKey = getExtensionIconKey(extensionId)
  return (
    extensionIcons[iconKey as keyof typeof extensionIcons] ??
    Widget6BoldDuotone
  )
}

export function getWorkspaceExtensionIconClass(extensionId: string) {
  const iconKey = getExtensionIconKey(extensionId)
  const mappedClass =
    extensionIconClasses[iconKey as keyof typeof extensionIconClasses]
  if (mappedClass) {
    return mappedClass
  }
  if (extensionId.startsWith("extension.userLocal.")) {
    return "bg-[linear-gradient(145deg,hsl(var(--primary)),hsl(213_74%_45%))] text-primary-foreground dark:shadow-[0_10px_24px_hsl(var(--primary)/0.22)]"
  }
  return "bg-[linear-gradient(145deg,hsl(var(--muted)),hsl(var(--card)))] text-muted-foreground dark:shadow-[0_10px_24px_hsl(220_10%_10%/0.12)]"
}

export function isEdgeToEdgeWorkspaceExtension(
  extensionId: string | null | undefined
) {
  return (
    extensionId === "extension.firstParty.browser" ||
    extensionId === "extension.firstParty.editor" ||
    extensionId === "extension.firstParty.terminal" ||
    extensionId === "extension.firstParty.pdfEditor" ||
    extensionId === "extension.firstParty.excalidraw" ||
    extensionId === "extension.firstParty.univerSheets" ||
    extensionId?.startsWith("extension.userLocal.") === true
  )
}
