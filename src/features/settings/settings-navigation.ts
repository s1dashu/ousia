import {
  Archive,
  BubbleChat,
  Code,
  PaintBrush,
  Settings,
} from "@/components/icons/huge-icons"
import type { OusiaAgentProvider } from "@/electron/chat-types"

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "conversation"
  | "provider"
  | "archivedSessions"

type SettingsNavigationCopy = {
  appearance: string
  codexSettings: string
  conversationSettings: string
  general: string
  piSettings: string
  archivedSessions: string
}

export function getSettingsNavigationItems(
  agentProvider: OusiaAgentProvider,
  copy: SettingsNavigationCopy
) {
  return [
    { icon: Settings, id: "general" as const, label: copy.general },
    { icon: PaintBrush, id: "appearance" as const, label: copy.appearance },
    {
      icon: BubbleChat,
      id: "conversation" as const,
      label: copy.conversationSettings,
    },
    {
      icon: Code,
      id: "provider" as const,
      label: agentProvider === "pi" ? copy.piSettings : copy.codexSettings,
    },
    {
      icon: Archive,
      id: "archivedSessions" as const,
      label: copy.archivedSessions,
    },
  ]
}
