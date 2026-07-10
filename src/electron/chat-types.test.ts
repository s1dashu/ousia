import { describe, expect, it } from "vitest"

import {
  createOusiaSession,
  createDefaultOusiaAppState,
  createDefaultOusiaProject,
  defaultOusiaAppSettings,
  isOusiaCodexReasoningEffort,
  isOusiaPiThinkingLevel,
  normalizeOusiaAppSettings,
  normalizeOusiaDisabledModelProviderIds,
  normalizeOusiaModelProviders,
  OUSIA_DEFAULT_WORK_DIR,
  OUSIA_LEGACY_DEFAULT_WORK_DIR,
  ousiaProjectNameFromPath,
  resolveOusiaChatContentWidthValue,
  resolveOusiaFontFamilyValue,
  type OusiaAppSettings,
} from "./chat-types"

describe("normalizeOusiaModelProviders", () => {
  it("keeps unique non-empty provider ids and strips transient keys", () => {
    expect(
      normalizeOusiaModelProviders({
        modelProviders: [
          { id: " deepseek ", apiKey: "secret" },
          { id: "deepseek", apiKey: "duplicate" },
          { id: " openai", apiKey: "another" },
          { id: " ", apiKey: "empty" },
        ],
      })
    ).toEqual([
      { id: "deepseek", apiKey: "" },
      { id: "openai", apiKey: "" },
    ])
  })
})

describe("normalizeOusiaDisabledModelProviderIds", () => {
  it("keeps unique non-empty disabled provider ids", () => {
    expect(
      normalizeOusiaDisabledModelProviderIds({
        disabledModelProviderIds: [" openai ", "openai", " ", "google"],
      })
    ).toEqual(["openai", "google"])
  })
})

describe("normalizeOusiaAppSettings", () => {
  it("normalizes invalid settings back to supported product defaults", () => {
    const settings = normalizeOusiaAppSettings({
      agentMode: "invalid",
      appearanceColorScale: "purple",
      appFontFamily: "bad-font",
      autoCompactContext: "yes",
      autoRetryOnFailure: "yes",
      chatContentWidth: "narrow",
      chatFontFamily: "bad-font",
      continueQueuedMessagesAfterInterrupt: "yes",
      codexModelId: 7,
      codexReasoningEffort: 7,
      customAgentTools: ["read", "explode", "read"],
      defaultAgentProvider: "other",
      defaultWorkDir: "   ",
      language: "fr",
      modelId: "   ",
      modelProvider: "   ",
      sendDuringRunMode: "later",
      showContextUsage: "yes",
      thinkingLevel: "ultra",
      disabledModelProviderIds: [" openai ", "openai"],
    } as unknown as Partial<OusiaAppSettings>)

    expect(settings).toMatchObject({
      agentMode: "standard",
      appearanceColorScale: defaultOusiaAppSettings.appearanceColorScale,
      appFontFamily: defaultOusiaAppSettings.appFontFamily,
      autoCompactContext: defaultOusiaAppSettings.autoCompactContext,
      autoRetryOnFailure: defaultOusiaAppSettings.autoRetryOnFailure,
      chatContentWidth: defaultOusiaAppSettings.chatContentWidth,
      chatFontFamily: defaultOusiaAppSettings.chatFontFamily,
      continueQueuedMessagesAfterInterrupt:
        defaultOusiaAppSettings.continueQueuedMessagesAfterInterrupt,
      codexModelId: "",
      codexReasoningEffort: null,
      defaultAgentProvider: "pi",
      defaultWorkDir: defaultOusiaAppSettings.defaultWorkDir,
      language: "zh",
      modelId: defaultOusiaAppSettings.modelId,
      modelProvider: defaultOusiaAppSettings.modelProvider,
      sendDuringRunMode: "steer",
      showContextUsage: defaultOusiaAppSettings.showContextUsage,
      thinkingLevel: defaultOusiaAppSettings.thinkingLevel,
      disabledModelProviderIds: ["openai"],
    })
    expect(settings.customAgentTools).toEqual(["read"])
  })

  it("maps the old development default work dir to the current default", () => {
    expect(
      normalizeOusiaAppSettings({
        defaultWorkDir: OUSIA_LEGACY_DEFAULT_WORK_DIR,
      }).defaultWorkDir
    ).toBe(OUSIA_DEFAULT_WORK_DIR)
  })

  it("keeps custom mode only with supported custom tools", () => {
    expect(
      normalizeOusiaAppSettings({
        agentMode: "custom",
        customAgentTools: ["bash", "write", "bash"],
      }).customAgentTools
    ).toEqual(["bash", "write"])
  })

  it("keeps the Codex provider and allows an empty Codex model id", () => {
    expect(
      normalizeOusiaAppSettings({
        codexModelId: "",
        defaultAgentProvider: "codex",
      })
    ).toMatchObject({
      codexModelId: "",
      defaultAgentProvider: "codex",
    })
  })

  it("keeps Pi and Codex reasoning preferences separate", () => {
    expect(
      normalizeOusiaAppSettings({
        thinkingLevel: "xhigh",
        codexReasoningEffort: " ultra ",
      })
    ).toMatchObject({
      thinkingLevel: "xhigh",
      codexReasoningEffort: "ultra",
    })
  })
})

describe("agent reasoning types", () => {
  it("keeps Codex effort strings out of the Pi thinking-level boundary", () => {
    expect(isOusiaPiThinkingLevel("xhigh")).toBe(true)
    expect(isOusiaPiThinkingLevel("max")).toBe(false)
    expect(isOusiaPiThinkingLevel("ultra")).toBe(false)
    expect(isOusiaCodexReasoningEffort("future-depth")).toBe(true)
    expect(isOusiaCodexReasoningEffort("   ")).toBe(false)
  })
})

describe("default state helpers", () => {
  it("creates a valid default app state with a selected session", () => {
    const state = createDefaultOusiaAppState()

    expect(state.schemaVersion).toBe(2)
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].agentProvider).toBe("pi")
    expect(state.settings.defaultAgentProvider).toBe("pi")
    expect(state.settings.codexModelId).toBe("")
    expect(state.settings.codexReasoningEffort).toBeNull()
    expect(state.projects).toEqual([])
    expect(state.selectedSessionId).toBe(state.sessions[0].id)
    expect(state.shellLayout.sidebarSectionOrder).toEqual([
      "sessions",
      "projects",
    ])
  })

  it("derives project names from POSIX and Windows paths", () => {
    expect(ousiaProjectNameFromPath("/Users/sida/code/ousia-desktop")).toBe(
      "ousia-desktop"
    )
    expect(ousiaProjectNameFromPath("C:\\Users\\sida\\Project")).toBe("Project")
  })

  it("creates the default project from the configured work dir", () => {
    expect(
      createDefaultOusiaProject({
        ...defaultOusiaAppSettings,
        defaultWorkDir: "~/Documents/Ousia",
      })
    ).toMatchObject({
      id: "default-workdir",
      name: "Ousia",
      path: "~/Documents/Ousia",
    })
  })

  it("creates sessions for the requested agent provider", () => {
    expect(createOusiaSession("Codex session", "codex")).toMatchObject({
      agentProvider: "codex",
      title: "Codex session",
    })
  })
})

describe("presentation setting helpers", () => {
  it("resolves font family values", () => {
    expect(resolveOusiaFontFamilyValue("system")).toContain("-apple-system")
    expect(resolveOusiaFontFamilyValue("lxgwWenkai")).toContain(
      "Ousia LXGW WenKai"
    )
    expect(resolveOusiaFontFamilyValue("zhuqueFangsong")).toContain(
      "Ousia Zhuque Fangsong"
    )
  })

  it("resolves chat content widths", () => {
    expect(resolveOusiaChatContentWidthValue("standard")).toBe("48rem")
    expect(resolveOusiaChatContentWidthValue("wide")).toBe("56rem")
    expect(resolveOusiaChatContentWidthValue("extraWide")).toBe("64rem")
  })
})
