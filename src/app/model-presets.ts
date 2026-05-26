export const modelPresets: Array<{
  provider: string
  modelId: string
  label: string
  description: string
}> = [
  {
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    description: "当前默认模型，适合快速编码任务。",
  },
  {
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    description: "更强的 DeepSeek 模型，适合复杂改动。",
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-4-5",
    label: "Claude Opus 4.5",
    description: "Anthropic 模型，适合复杂编码工作。",
  },
  {
    provider: "openai",
    modelId: "gpt-5.2",
    label: "GPT-5.2",
    description: "OpenAI 模型，适合通用编码和推理任务。",
  },
  {
    provider: "google",
    modelId: "gemini-3-pro-preview",
    label: "Gemini 3 Pro Preview",
    description: "Google 模型，需先配置 Gemini 认证。",
  },
]

export function modelPresetValue(provider: string, modelId: string) {
  return `${provider}/${modelId}`
}

export function findModelPreset(provider: string, modelId: string) {
  return modelPresets.find(
    (preset) => preset.provider === provider && preset.modelId === modelId
  )
}
