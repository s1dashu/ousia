import type { ExtensionContext } from "@/extensions/types"

export const extensionContext: ExtensionContext = {
  extensionId: "extension.preview",
  tabId: "extension.preview",
  project: {
    id: "ousia-desktop",
    name: "ousia-desktop",
    path: "/Users/bytedance/Downloads/ousia-desktop",
  },
  conversation: {
    id: "desktop-mvp",
    title: "桌面 MVP",
  },
  agent: {
    thinkingLevel: "medium",
    model: {
      provider: "openai",
      modelId: "gpt-5",
    },
  },
  theme: {
    preference: "system",
    resolved: "light",
  },
  state: {
    async get() {
      return null
    },
    async set() {},
    async delete() {},
  },
}
