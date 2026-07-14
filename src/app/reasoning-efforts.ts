import {
  isOusiaPiThinkingLevel,
  type OusiaAppSettings,
  type OusiaAvailableModel,
  type OusiaReasoningEffort,
} from "@/electron/chat-types"

const knownReasoningEffortLabels: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
}

export function reasoningEffortLabel(effort: OusiaReasoningEffort) {
  return knownReasoningEffortLabels[effort] ?? effort
}

export function reasoningPreferencePatch(
  effort: OusiaReasoningEffort
): Pick<OusiaAppSettings, "thinkingLevel"> {
  if (!isOusiaPiThinkingLevel(effort)) {
    throw new Error(`Unsupported Pi thinking level: ${effort}`)
  }
  return { thinkingLevel: effort }
}

export function resolveModelReasoningEffort(
  model: Pick<
    OusiaAvailableModel,
    "defaultThinkingLevel" | "modelId" | "thinkingLevels"
  > | undefined,
  preferred: OusiaReasoningEffort | null | undefined,
  fallback: OusiaReasoningEffort = "medium"
) {
  if (!model) {
    return preferred ?? fallback
  }
  if (model.thinkingLevels.length === 0) {
    throw new Error(`Model ${model.modelId} has no supported reasoning efforts.`)
  }
  if (preferred && model.thinkingLevels.includes(preferred)) {
    return preferred
  }
  if (model.defaultThinkingLevel) {
    if (!model.thinkingLevels.includes(model.defaultThinkingLevel)) {
      throw new Error(
        `Model ${model.modelId} has an invalid default reasoning effort: ${model.defaultThinkingLevel}`
      )
    }
    return model.defaultThinkingLevel
  }
  return model.thinkingLevels.includes(fallback)
    ? fallback
    : model.thinkingLevels[0]
}
