import type { OusiaLanguage } from "./chat-types.js"

const MAX_ENGLISH_TITLE_WORDS = 8
const MAX_ENGLISH_TITLE_CHARACTERS = 80
const MAX_CHINESE_TITLE_CHARACTERS = 16

export function buildPlainChatTitleRequest(
  language: OusiaLanguage,
  prompt: string
) {
  if (language === "en") {
    return {
      systemPrompt:
        "You generate concise English titles for desktop agent conversations. Output only the title, without explanations, quotation marks, or surrounding punctuation. Use no more than 8 words.",
      userPrompt: `Generate a title for this first user message:\n${prompt}`,
    }
  }

  return {
    systemPrompt:
      "你负责给桌面智能体会话生成中文短标题。只输出标题本身，不要解释，不要引号，不要标点包装。标题必须在 16 个字符以内，可长可短。",
    userPrompt: `根据这条首轮用户消息生成会话名称：\n${prompt}`,
  }
}

export function buildStructuredChatTitlePrompt(
  language: OusiaLanguage,
  prompt: string
) {
  if (language === "en") {
    return `Generate a concise English title of no more than 8 words for the user request below. Return JSON only.\n\n${prompt}`
  }

  return `为下面的用户请求生成一个简短中文会话标题，不超过 16 个中文字符。只返回 JSON。\n\n${prompt}`
}

export function normalizeGeneratedChatTitle(
  value: string,
  language: OusiaLanguage
) {
  const title = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^["'“”‘’「」『』《》\s]+|["'“”‘’「」『』《》\s]+$/g, "")
    .replace(
      /^(?:会话名称|会话标题|标题|名称|chat title|conversation title|title|name)\s*[:：]\s*/i,
      ""
    )
    .trim()

  if (!title) {
    return ""
  }

  if (language === "zh") {
    return Array.from(title)
      .slice(0, MAX_CHINESE_TITLE_CHARACTERS)
      .join("")
  }

  const words = title.replace(/\s+/g, " ").split(" ")
  return Array.from(words.slice(0, MAX_ENGLISH_TITLE_WORDS).join(" "))
    .slice(0, MAX_ENGLISH_TITLE_CHARACTERS)
    .join("")
    .trim()
}
