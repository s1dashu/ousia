import type { OusiaCodexEnvironmentStatus } from "@/electron/chat-types"

export type CodexSendBlockReason = "sign-in-required" | "unavailable"

/**
 * An undefined status means discovery is still cold. It must not block a send:
 * the main-process send path is authoritative and can initialize Codex itself.
 */
export function codexSendBlockReason(
  status: OusiaCodexEnvironmentStatus | undefined
): CodexSendBlockReason | undefined {
  if (status?.available === false) {
    return "unavailable"
  }
  if (status?.requiresOpenaiAuth && !status.account) {
    return "sign-in-required"
  }
  return undefined
}
