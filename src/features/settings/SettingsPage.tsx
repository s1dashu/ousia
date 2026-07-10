import { useEffect, useState } from "react"
import {
  Ban,
  Check,
  Eye,
  EyeOff,
  FolderOpen,
  Plus,
  Trash2,
  X,
} from "@/components/icons/huge-icons"

import { getMessages, languageOptions } from "@/app/i18n"
import { getConfiguredModelPresets, providerLabel } from "@/app/model-presets"
import type { AppSettings } from "@/app/app-state"
import { useTheme, type Theme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  normalizeOusiaAppSettings,
  type OusiaAgentMode,
  type OusiaAgentProvider,
  type OusiaAppearanceColorScale,
  type OusiaChatContentWidth,
  type OusiaCodexEnvironmentStatus,
  type OusiaFontFamily,
  type OusiaLanguage,
  type OusiaModelRegistryResult,
  type OusiaSendDuringRunMode,
} from "@/electron/chat-types"
import { cn } from "@/lib/utils"

const appearanceColorScales: Array<{
  label: string
  value: OusiaAppearanceColorScale
  description: string
}> = [
  { label: "Tea", value: "tea", description: "" },
  { label: "Paper", value: "paper", description: "#FAFAF8 paper surfaces" },
  { label: "Sand", value: "sand", description: "" },
  { label: "Gray", value: "gray", description: "" },
  { label: "Slate", value: "slate", description: "" },
  { label: "Mauve", value: "mauve", description: "" },
  { label: "Sage", value: "sage", description: "" },
]

type SettingsPageProps = {
  codexEnvironment: OusiaCodexEnvironmentStatus | undefined
  isSidebarCollapsed: boolean
  isWindowFullscreen: boolean
  modelRegistry: OusiaModelRegistryResult | undefined
  onClose: () => void
  onRefreshCodexEnvironment: () => Promise<
    OusiaCodexEnvironmentStatus | undefined
  >
  onRefreshModelRegistry: () => Promise<OusiaModelRegistryResult | undefined>
  onSettingsChange: (settings: AppSettings) => void
  settings: AppSettings
}

const settingsContentClass =
  "mx-auto grid w-full max-w-[var(--ousia-settings-content-max-width)] gap-8"
const settingsSectionClass = "grid gap-4"
const settingsFieldClass = "grid gap-2"
const settingsLabelClass = "text-xs font-medium text-muted-foreground"
const settingsHelpClass = "text-xs leading-5 text-muted-foreground"
const settingsControlClass =
  "ousia-squircle-corners w-full rounded-xl border-[0.5px] border-foreground/10"

type ProviderRow = {
  apiKey: string
  authLabel?: string
  authSource?: NonNullable<
    OusiaModelRegistryResult["configuredProviders"][number]["authSource"]
  >
  id: string
  isDisabled: boolean
}

export function SettingsPage({
  codexEnvironment,
  isSidebarCollapsed,
  isWindowFullscreen,
  modelRegistry,
  onClose,
  onRefreshCodexEnvironment,
  onRefreshModelRegistry,
  onSettingsChange,
  settings,
}: SettingsPageProps) {
  const [draft, setDraft] = useState(settings)
  const [isAddProviderDialogOpen, setIsAddProviderDialogOpen] = useState(false)
  const [newProviderId, setNewProviderId] = useState("")
  const [newProviderApiKey, setNewProviderApiKey] = useState("")
  const [visibleProviderApiKeyIds, setVisibleProviderApiKeyIds] = useState<
    Set<string>
  >(() => new Set())
  const [savingProviderIds, setSavingProviderIds] = useState<Set<string>>(
    () => new Set()
  )
  const [codexAction, setCodexAction] = useState<
    "login" | "logout" | "refresh" | null
  >(null)
  const [codexError, setCodexError] = useState("")
  const [providerError, setProviderError] = useState("")
  const { setTheme } = useTheme()
  const t = getMessages(draft.language)
  const themeOptions: Array<{
    label: string
    value: Theme
  }> = [
    { label: t.settings.systemTheme, value: "system" },
    { label: t.settings.lightTheme, value: "light" },
    { label: t.settings.darkTheme, value: "dark" },
  ]
  const sendDuringRunModeOptions: Array<{
    label: string
    value: OusiaSendDuringRunMode
  }> = [
    { label: t.settings.queue, value: "queue" },
    { label: t.settings.steer, value: "steer" },
  ]
  const agentModeOptions: Array<{
    description: string
    label: string
    value: OusiaAgentMode
  }> = [
    {
      description: t.settings.standardModeDescription,
      label: t.settings.standardMode,
      value: "standard",
    },
    {
      description: t.settings.readOnlyModeDescription,
      label: t.settings.readOnlyMode,
      value: "readOnly",
    },
    {
      description: t.settings.noTerminalModeDescription,
      label: t.settings.noTerminalMode,
      value: "noTerminal",
    },
    {
      description: t.settings.customModeDescription,
      label: t.settings.customMode,
      value: "custom",
    },
  ]
  const fontFamilyOptions: Array<{
    label: string
    value: OusiaFontFamily
  }> = [
    { label: t.settings.fontSystem, value: "system" },
    { label: t.settings.fontLxgwWenkai, value: "lxgwWenkai" },
    { label: t.settings.fontZhuqueFangsong, value: "zhuqueFangsong" },
  ]
  const chatContentWidthOptions: Array<{
    label: string
    value: OusiaChatContentWidth
  }> = [
    { label: t.settings.chatWidthStandard, value: "standard" },
    { label: t.settings.chatWidthWide, value: "wide" },
    { label: t.settings.chatWidthExtraWide, value: "extraWide" },
  ]

  useEffect(() => {
    queueMicrotask(() => setDraft(settings))
  }, [settings])

  function updateDraft(patch: Partial<AppSettings>) {
    setDraft((current) => ({
      ...current,
      ...patch,
    }))
  }

  function applySettings(patch: Partial<AppSettings>) {
    const nextSettings = normalizeOusiaAppSettings({
      ...settings,
      ...patch,
    })
    setDraft((current) => ({
      ...current,
      ...nextSettings,
    }))
    onSettingsChange(nextSettings)
  }

  function applyThemeSetting(nextTheme: Theme) {
    setTheme(nextTheme)
    applySettings({ theme: nextTheme })
  }

  async function refreshCodexStatus() {
    setCodexAction("refresh")
    setCodexError("")
    try {
      const status = await onRefreshCodexEnvironment()
      if (!status) {
        setCodexError(t.chat.noElectron)
      }
    } catch (error) {
      setCodexError(
        error instanceof Error
          ? error.message
          : String(error ?? t.settings.codexRefreshFailed)
      )
    } finally {
      setCodexAction(null)
    }
  }

  async function runCodexAuthAction(action: "login" | "logout") {
    if (!window.ousia) {
      setCodexError(t.chat.noElectron)
      return
    }
    setCodexAction(action)
    setCodexError("")
    try {
      const result =
        action === "login"
          ? await window.ousia.loginCodexWithChatGPT()
          : await window.ousia.logoutCodex()
      if (!result.ok) {
        setCodexError(result.error)
      }
      const status = await onRefreshCodexEnvironment()
      if (!status && result.ok) {
        setCodexError(t.settings.codexRefreshFailed)
      }
    } catch (error) {
      setCodexError(
        error instanceof Error
          ? error.message
          : String(error ?? t.settings.codexAuthActionFailed)
      )
    } finally {
      setCodexAction(null)
    }
  }

  function commitRequiredTextSetting(key: "defaultWorkDir") {
    const value = draft[key].trim()
    if (!value) {
      updateDraft({ [key]: settings[key] })
      return
    }
    applySettings({ [key]: value })
  }

  async function chooseDefaultWorkDir() {
    if (!window.ousia) {
      const rawPath = window.prompt(
        t.settings.defaultWorkDirPrompt,
        draft.defaultWorkDir
      )
      if (!rawPath?.trim()) {
        return
      }
      applySettings({ defaultWorkDir: rawPath.trim() })
      return
    }
    const result = await window.ousia.selectDirectory({
      defaultPath: draft.defaultWorkDir,
    })
    if (result.canceled) {
      return
    }
    applySettings({ defaultWorkDir: result.path })
  }

  function rememberProviderId(providerId: string) {
    return settings.modelProviders.some(
      (provider) => provider.id === providerId
    )
      ? settings.modelProviders.map((provider) =>
          provider.id === providerId ? { ...provider, apiKey: "" } : provider
        )
      : [
          ...settings.modelProviders,
          {
            id: providerId,
            apiKey: "",
          },
        ]
  }

  function currentModelVisibilityPatch(
    modelProviders: AppSettings["modelProviders"],
    disabledModelProviderIds: string[]
  ): Pick<AppSettings, "modelProvider" | "modelId"> | Record<string, never> {
    const configuredModelPresets = getConfiguredModelPresets(
      modelProviders,
      modelRegistry,
      disabledModelProviderIds
    )
    const currentModel = configuredModelPresets.find(
      (model) =>
        model.provider === settings.modelProvider &&
        model.modelId === settings.modelId
    )
    if (currentModel) {
      return {}
    }
    const fallbackModel = configuredModelPresets[0]
    return fallbackModel
      ? {
          modelProvider: fallbackModel.provider,
          modelId: fallbackModel.modelId,
        }
      : {}
  }

  async function persistProviderCredential(providerId: string, apiKey: string) {
    if (!window.ousia) {
      setProviderError(t.chat.noElectron)
      return false
    }
    setProviderError("")
    setSavingProviderIds((current) => new Set(current).add(providerId))
    try {
      const result = await window.ousia
        .savePiProviderCredential({
          apiKey,
          provider: providerId,
        })
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }))
      if (!result.ok) {
        setProviderError(result.error ?? t.settings.providerSaveFailed)
        return false
      }
      await onRefreshModelRegistry().catch(() => undefined)
      return true
    } finally {
      setSavingProviderIds((current) => {
        const next = new Set(current)
        next.delete(providerId)
        return next
      })
    }
  }

  async function removeProviderCredential(providerId: string) {
    if (!window.ousia) {
      setProviderError(t.chat.noElectron)
      return false
    }
    setProviderError("")
    setSavingProviderIds((current) => new Set(current).add(providerId))
    try {
      const result = await window.ousia
        .removePiProviderCredential({
          provider: providerId,
        })
        .catch((error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }))
      if (!result.ok) {
        setProviderError(result.error ?? t.settings.providerRemoveFailed)
        return false
      }
      await onRefreshModelRegistry().catch(() => undefined)
      return true
    } finally {
      setSavingProviderIds((current) => {
        const next = new Set(current)
        next.delete(providerId)
        return next
      })
    }
  }

  async function addProvider() {
    const id = newProviderId.trim()
    const provider = modelRegistry?.providers.find((item) => item.id === id)
    if (!provider || !newProviderApiKey.trim()) {
      return
    }
    const didSave = await persistProviderCredential(
      id,
      newProviderApiKey.trim()
    )
    if (!didSave) {
      return
    }
    const nextModelId = provider.models[0]?.modelId || settings.modelId
    applySettings({
      modelProvider: id,
      modelId: nextModelId,
      modelProviders: rememberProviderId(id),
      disabledModelProviderIds: settings.disabledModelProviderIds.filter(
        (providerId) => providerId !== id
      ),
    })
    setNewProviderId("")
    setNewProviderApiKey("")
    setIsAddProviderDialogOpen(false)
  }

  function updateProviderDraft(providerId: string, apiKey: string) {
    const nextModelProviders = draft.modelProviders.some(
      (provider) => provider.id === providerId
    )
      ? draft.modelProviders.map((provider) =>
          provider.id === providerId ? { ...provider, apiKey } : provider
        )
      : [
          ...draft.modelProviders,
          {
            id: providerId,
            apiKey,
          },
        ]
    updateDraft({
      modelProviders: nextModelProviders,
    })
    if (!apiKey.trim()) {
      setVisibleProviderApiKeyIds((current) => {
        const nextIds = new Set(current)
        nextIds.delete(providerId)
        return nextIds
      })
    }
  }

  async function commitProviderApiKey(providerId: string) {
    const draftProvider = draft.modelProviders.find(
      (provider) => provider.id === providerId
    )
    const apiKey = draftProvider?.apiKey.trim()
    if (!draftProvider || !apiKey) {
      return
    }
    const didSave = await persistProviderCredential(providerId, apiKey)
    if (!didSave) {
      return
    }
    applySettings({
      modelProviders: rememberProviderId(providerId),
    })
    updateDraft({
      modelProviders: draft.modelProviders.map((provider) =>
        provider.id === providerId ? { ...provider, apiKey: "" } : provider
      ),
    })
  }

  function providerAuthDescription(provider: ProviderRow) {
    if (provider.authSource === "stored") {
      return t.settings.configuredInPi
    }
    if (provider.authSource === "environment") {
      return t.settings.configuredFromEnvironment(provider.authLabel)
    }
    if (provider.authSource === "models_json_key") {
      return t.settings.configuredFromModelsJson
    }
    if (provider.authSource === "models_json_command") {
      return t.settings.configuredFromModelsJsonCommand
    }
    if (provider.authSource === "fallback") {
      return t.settings.configuredFromFallback
    }
    if (provider.authSource === "runtime") {
      return t.settings.configuredFromRuntime
    }
    return t.settings.configuredInPi
  }

  async function deleteProvider(provider: ProviderRow) {
    const providerId = provider.id
    if (provider.authSource && provider.authSource !== "stored") {
      setProviderError(
        t.settings.providerRemoveUnavailable(providerAuthDescription(provider))
      )
      return
    }
    if (provider.authSource === "stored") {
      const didRemove = await removeProviderCredential(providerId)
      if (!didRemove) {
        return
      }
    }
    const nextProviders = settings.modelProviders.filter(
      (provider) => provider.id !== providerId
    )
    const nextDisabledProviderIds = settings.disabledModelProviderIds.filter(
      (id) => id !== providerId
    )
    applySettings({
      modelProviders: nextProviders,
      disabledModelProviderIds: nextDisabledProviderIds,
      ...currentModelVisibilityPatch(nextProviders, nextDisabledProviderIds),
    })
    setVisibleProviderApiKeyIds((current) => {
      const nextIds = new Set(current)
      nextIds.delete(providerId)
      return nextIds
    })
  }

  function toggleProviderDisabled(provider: ProviderRow) {
    const providerId = provider.id
    const nextDisabledProviderIds = provider.isDisabled
      ? settings.disabledModelProviderIds.filter((id) => id !== providerId)
      : [...settings.disabledModelProviderIds, providerId]
    setProviderError("")
    applySettings({
      disabledModelProviderIds: nextDisabledProviderIds,
      ...currentModelVisibilityPatch(
        settings.modelProviders,
        nextDisabledProviderIds
      ),
    })
  }

  function toggleProviderApiKeyVisibility(providerId: string) {
    setVisibleProviderApiKeyIds((current) => {
      const nextIds = new Set(current)
      if (nextIds.has(providerId)) {
        nextIds.delete(providerId)
      } else {
        nextIds.add(providerId)
      }
      return nextIds
    })
  }

  const configuredProviderIds = new Set([
    ...draft.modelProviders.map((provider) => provider.id),
    ...draft.disabledModelProviderIds,
    ...(modelRegistry?.configuredProviderIds ?? []),
  ])
  const disabledProviderIdSet = new Set(
    draft.disabledModelProviderIds.map((id) => id.trim()).filter(Boolean)
  )
  const configuredProviderById = new Map(
    (modelRegistry?.configuredProviders ?? []).map((provider) => [
      provider.id,
      provider,
    ])
  )
  const providerRows: ProviderRow[] = [...configuredProviderIds]
    .filter(Boolean)
    .map((providerId) => {
      const configuredProvider = configuredProviderById.get(providerId)
      return {
        id: providerId,
        apiKey:
          draft.modelProviders.find((provider) => provider.id === providerId)
            ?.apiKey ?? "",
        authLabel: configuredProvider?.authLabel,
        authSource: configuredProvider?.authSource,
        isDisabled: disabledProviderIdSet.has(providerId),
      }
    })
    .sort((left, right) =>
      providerLabel(modelRegistry, left.id).localeCompare(
        providerLabel(modelRegistry, right.id),
        undefined,
        { sensitivity: "base" }
      )
    )
  const configuredProviderIdSet = new Set(
    providerRows.map((provider) => provider.id)
  )
  const addableProviders =
    modelRegistry?.providers.filter(
      (provider) =>
        provider.models.length > 0 && !configuredProviderIdSet.has(provider.id)
    ) ?? []
  const addableProviderSelectItems = addableProviders.map((provider) => ({
    label: provider.name,
    value: provider.id,
  }))
  const hasAddableProvider = addableProviders.some(
    (provider) => provider.id === newProviderId
  )
  const canAddProvider =
    hasAddableProvider &&
    Boolean(newProviderApiKey.trim()) &&
    !savingProviderIds.has(newProviderId)

  function openAddProviderDialog() {
    const defaultProvider =
      addableProviders.find((provider) => provider.id === "deepseek") ??
      addableProviders[0]
    setNewProviderId(defaultProvider?.id ?? "")
    setNewProviderApiKey("")
    setIsAddProviderDialogOpen(true)
  }

  const selectedColorScaleDescription = appearanceColorScales.find(
    (scale) => scale.value === draft.appearanceColorScale
  )?.description
  const codexAccount = codexEnvironment?.account
  const codexChatGptDetails =
    codexAccount?.type === "chatgpt"
      ? [codexAccount.email, codexAccount.planType].filter(Boolean).join(" · ")
      : ""
  const codexStatus = !codexEnvironment
    ? {
        description: t.settings.codexUncheckedHelp,
        label: t.settings.codexUnchecked,
      }
    : !codexEnvironment.available
      ? {
          description:
            codexEnvironment.error || t.settings.codexUnavailableHelp,
          label: t.settings.codexUnavailable,
        }
      : !codexAccount
        ? {
            description: t.settings.codexSignedOutHelp,
            label: t.settings.codexSignedOut,
          }
        : codexAccount.type === "apiKey"
          ? {
              description: t.settings.codexApiKeyHelp,
              label: t.settings.codexApiKeyAccount,
            }
          : {
              description:
                codexChatGptDetails || t.settings.codexChatGptAccountHelp,
              label: t.settings.codexChatGptAccount,
            }

  return (
    <section className="ousia-main-panel ousia-squircle-corners @container/settings flex min-w-0 flex-1 flex-col overflow-hidden rounded-l-none rounded-r-[var(--ousia-chat-panel-radius)] border-[0.5px] border-l-0 border-border/60 bg-white shadow-[var(--ousia-main-panel-shadow)] dark:bg-card">
      <header className="window-drag grid h-[var(--ousia-titlebar-height)] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pr-4 pl-4">
        <div
          className={cn(
            "window-drag flex min-w-0 items-center self-stretch",
            isSidebarCollapsed &&
              (isWindowFullscreen
                ? "pl-[var(--ousia-titlebar-height)]"
                : "pl-[var(--ousia-titlebar-sidebar-offset)]")
          )}
        >
          <div className="window-drag flex min-w-0 flex-1 items-center self-stretch pl-2">
            <h1 className="window-drag truncate text-sm leading-none font-normal">
              {t.app.settings}
            </h1>
          </div>
        </div>
        <div className="window-drag flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="window-no-drag ousia-squircle-corners size-6 rounded-lg"
            aria-label={t.app.close}
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </div>
      </header>
      <div className="ousia-hover-scrollbar min-h-0 flex-1 overflow-auto px-[var(--ousia-settings-gutter)] py-8">
        <div className={settingsContentClass}>
          <section className={settingsSectionClass}>
            <h2 className="text-sm font-semibold">{t.settings.general}</h2>
            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>{t.settings.language}</span>
              <Select
                items={languageOptions}
                value={draft.language}
                onValueChange={(value) =>
                  applySettings({ language: value as OusiaLanguage })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.language}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {languageOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className={settingsSectionClass}>
            <h2 className="text-sm font-semibold">{t.settings.appearance}</h2>
            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>
                {t.settings.appearanceMode}
              </span>
              <Select
                items={themeOptions}
                value={draft.theme}
                onValueChange={(value) => applyThemeSetting(value as Theme)}
              >
                <SelectTrigger
                  aria-label={t.settings.appearanceMode}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {themeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>
                {t.settings.appFontFamily}
              </span>
              <Select
                items={fontFamilyOptions}
                value={draft.appFontFamily}
                onValueChange={(value) =>
                  applySettings({
                    appFontFamily: value as OusiaFontFamily,
                  })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.appFontFamily}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {fontFamilyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>
                {t.settings.chatFontFamily}
              </span>
              <Select
                items={fontFamilyOptions}
                value={draft.chatFontFamily}
                onValueChange={(value) =>
                  applySettings({
                    chatFontFamily: value as OusiaFontFamily,
                  })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.chatFontFamily}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {fontFamilyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>
                {t.settings.chatContentWidth}
              </span>
              <Select
                items={chatContentWidthOptions}
                value={draft.chatContentWidth}
                onValueChange={(value) =>
                  applySettings({
                    chatContentWidth: value as OusiaChatContentWidth,
                  })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.chatContentWidth}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {chatContentWidthOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>
                {t.settings.colorScale}
              </span>
              <Select
                items={appearanceColorScales}
                value={draft.appearanceColorScale}
                onValueChange={(value) =>
                  applySettings({
                    appearanceColorScale: value as OusiaAppearanceColorScale,
                  })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.colorScale}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {appearanceColorScales.map((scale) => (
                      <SelectItem key={scale.value} value={scale.value}>
                        {scale.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {selectedColorScaleDescription ? (
              <div className={settingsHelpClass}>
                {selectedColorScaleDescription}
              </div>
            ) : null}
          </section>

          <section className={settingsSectionClass}>
            <h2 className="text-sm font-semibold">{t.settings.agent}</h2>
            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>
                {t.settings.defaultAgent}
              </span>
              <Select
                items={[
                  { label: t.settings.piAgent, value: "pi" },
                  { label: t.settings.codexAgent, value: "codex" },
                ]}
                value={draft.defaultAgentProvider}
                onValueChange={(value) =>
                  applySettings({
                    defaultAgentProvider: value as OusiaAgentProvider,
                  })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.defaultAgent}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value="pi">{t.settings.piAgent}</SelectItem>
                    <SelectItem value="codex">
                      {t.settings.codexAgent}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <div className={settingsHelpClass}>
                {t.settings.defaultAgentHelp}
              </div>
            </div>

            <div className="ousia-squircle-corners grid gap-3 rounded-xl border-[0.5px] border-foreground/10 bg-white p-4 dark:bg-background">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1" aria-live="polite">
                  <div className={settingsLabelClass}>
                    {t.settings.codexAuthentication}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground/85">
                    {codexStatus.label}
                  </div>
                  <div className={cn("mt-1", settingsHelpClass)}>
                    {codexStatus.description}
                  </div>
                </div>
                {!codexEnvironment || !codexEnvironment.available ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="ousia-squircle-corners rounded-xl border-transparent bg-muted/45 hover:bg-muted/60 active:scale-[0.96]"
                    disabled={codexAction !== null}
                    onClick={() => void refreshCodexStatus()}
                  >
                    {codexAction === "refresh"
                      ? t.settings.checkingCodex
                      : codexEnvironment
                        ? t.settings.retryCodexCheck
                        : t.settings.checkCodex}
                  </Button>
                ) : codexAccount ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="ousia-squircle-corners rounded-xl border-transparent bg-muted/45 hover:bg-muted/60 active:scale-[0.96]"
                    disabled={codexAction !== null}
                    onClick={() => void runCodexAuthAction("logout")}
                  >
                    {codexAction === "logout"
                      ? t.settings.signingOutCodex
                      : t.settings.signOutCodex}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="ousia-squircle-corners rounded-xl border-transparent bg-muted/45 hover:bg-muted/60 active:scale-[0.96]"
                    disabled={codexAction !== null}
                    onClick={() => void runCodexAuthAction("login")}
                  >
                    {codexAction === "login"
                      ? t.settings.signingInCodex
                      : t.settings.signInCodex}
                  </Button>
                )}
              </div>
              {codexError ? (
                <div
                  role="alert"
                  className="text-xs leading-5 text-destructive"
                >
                  {codexError}
                </div>
              ) : null}
            </div>

            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>{t.settings.agentMode}</span>
              <Select
                items={agentModeOptions}
                value={draft.agentMode}
                onValueChange={(value) =>
                  applySettings({ agentMode: value as OusiaAgentMode })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.agentMode}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {agentModeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <div className={settingsHelpClass}>
                {
                  agentModeOptions.find(
                    (option) => option.value === draft.agentMode
                  )?.description
                }
              </div>
            </div>
            <div className={settingsFieldClass}>
              <span className={settingsLabelClass}>
                {t.settings.appendMessages}
              </span>
              <Select
                items={sendDuringRunModeOptions}
                value={draft.sendDuringRunMode}
                onValueChange={(value) =>
                  applySettings({
                    sendDuringRunMode: value as OusiaSendDuringRunMode,
                  })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.appendMessages}
                  className={settingsControlClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {sendDuringRunModeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className={settingsLabelClass}>
                {t.settings.showContextUsage}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.showContextUsage}
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                  draft.showContextUsage ? "bg-foreground" : "bg-muted"
                )}
                onClick={() =>
                  applySettings({ showContextUsage: !draft.showContextUsage })
                }
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-[left]",
                    draft.showContextUsage ? "left-[18px]" : "left-0.5"
                  )}
                />
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className={settingsLabelClass}>
                {t.settings.continueQueuedAfterInterrupt}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.continueQueuedMessagesAfterInterrupt}
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                  draft.continueQueuedMessagesAfterInterrupt
                    ? "bg-foreground"
                    : "bg-muted"
                )}
                onClick={() =>
                  applySettings({
                    continueQueuedMessagesAfterInterrupt:
                      !draft.continueQueuedMessagesAfterInterrupt,
                  })
                }
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-[left]",
                    draft.continueQueuedMessagesAfterInterrupt
                      ? "left-[18px]"
                      : "left-0.5"
                  )}
                />
              </button>
            </div>
          </section>

          <section className={settingsSectionClass}>
            <div className="grid gap-1">
              <h2 className="text-sm font-semibold">{t.settings.model}</h2>
              <div className={settingsHelpClass}>
                {t.settings.piModelProvidersHelp}
              </div>
            </div>
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className={settingsLabelClass}>
                  {t.settings.providerKeys}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="ousia-squircle-corners rounded-xl border-transparent bg-muted/45 hover:bg-muted/60 active:scale-[0.96]"
                  disabled={!addableProviders.length}
                  onClick={openAddProviderDialog}
                >
                  <Plus size={18} />
                  {t.app.add}
                </Button>
              </div>
              <div className="-mx-1 grid min-w-0 gap-2 px-1 py-1">
                {providerRows.map((provider) => {
                  const providerHasApiKey = Boolean(provider.apiKey.trim())
                  const isProviderApiKeyVisible = visibleProviderApiKeyIds.has(
                    provider.id
                  )
                  const isProviderSaving = savingProviderIds.has(provider.id)
                  const providerAuthPlaceholder =
                    providerAuthDescription(provider)

                  return (
                    <div
                      key={provider.id}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_40px_40px] items-center gap-x-3 gap-y-2 py-1 @min-[560px]:grid-cols-[minmax(0,176px)_minmax(0,1fr)_40px_40px]"
                    >
                      <div
                        className={cn(
                          "flex min-h-10 min-w-0 items-center gap-2 text-sm font-medium text-foreground/75",
                          provider.isDisabled && "text-muted-foreground"
                        )}
                      >
                        <span className="block truncate">
                          {providerLabel(modelRegistry, provider.id)}
                        </span>
                        {provider.isDisabled ? (
                          <span className="ousia-squircle-corners shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] leading-4 font-medium text-muted-foreground">
                            {t.settings.disabled}
                          </span>
                        ) : null}
                      </div>
                      <div className="relative col-span-3 row-start-2 min-w-0 @min-[560px]:col-span-1 @min-[560px]:row-auto">
                        <Input
                          aria-label={`${provider.id} API Key`}
                          className={cn(
                            "ousia-squircle-corners min-w-0 rounded-xl border-[0.5px] border-foreground/10 bg-background/85 pr-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] focus-visible:bg-background disabled:opacity-100 dark:bg-input/45 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] dark:focus-visible:bg-input/60",
                            provider.isDisabled &&
                              "bg-muted/35 text-muted-foreground dark:bg-muted/20"
                          )}
                          disabled={isProviderSaving || provider.isDisabled}
                          value={provider.apiKey}
                          onChange={(event) =>
                            updateProviderDraft(provider.id, event.target.value)
                          }
                          onBlur={() => void commitProviderApiKey(provider.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur()
                            }
                          }}
                          placeholder={providerAuthPlaceholder}
                          type={
                            providerHasApiKey && isProviderApiKeyVisible
                              ? "text"
                              : "password"
                          }
                        />
                        {providerHasApiKey ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="ousia-squircle-corners absolute top-1/2 right-1 size-7 -translate-y-1/2 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
                            aria-label={
                              isProviderApiKeyVisible
                                ? t.settings.hideApiKey
                                : t.settings.showApiKey
                            }
                            onClick={() =>
                              toggleProviderApiKeyVisibility(provider.id)
                            }
                          >
                            {isProviderApiKeyVisible ? (
                              <EyeOff size={18} />
                            ) : (
                              <Eye size={18} />
                            )}
                          </Button>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          "ousia-squircle-corners justify-self-end rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-[0.96]",
                          provider.isDisabled && "text-foreground/75"
                        )}
                        aria-label={`${
                          provider.isDisabled
                            ? t.settings.enableProvider
                            : t.settings.disableProvider
                        } ${provider.id}`}
                        disabled={isProviderSaving}
                        title={
                          provider.isDisabled
                            ? t.settings.enableProvider
                            : t.settings.disableProvider
                        }
                        onClick={() => toggleProviderDisabled(provider)}
                      >
                        {provider.isDisabled ? (
                          <Check size={18} />
                        ) : (
                          <Ban size={18} />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ousia-squircle-corners justify-self-end rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
                        aria-label={`${t.app.delete} ${provider.id}`}
                        disabled={isProviderSaving}
                        onClick={() => void deleteProvider(provider)}
                      >
                        <Trash2 size={18} />
                      </Button>
                    </div>
                  )
                })}
              </div>
              {providerError ? (
                <div className="rounded-xl border-[0.5px] border-red-500/20 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                  {providerError}
                </div>
              ) : null}
            </div>
            <Dialog
              open={isAddProviderDialogOpen}
              onOpenChange={setIsAddProviderDialogOpen}
            >
              <DialogContent>
                <div className="flex items-start justify-between gap-4">
                  <DialogHeader>
                    <DialogTitle>{t.settings.addProvider}</DialogTitle>
                    <DialogDescription>
                      {t.settings.addProviderDescription}
                    </DialogDescription>
                  </DialogHeader>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="ousia-squircle-corners mt-0.5 rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 active:scale-[0.96]"
                    aria-label={t.app.close}
                    onClick={() => setIsAddProviderDialogOpen(false)}
                  >
                    <X size={18} />
                  </Button>
                </div>

                <label className="mt-4 block">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t.settings.provider}
                  </span>
                  <Select
                    items={addableProviderSelectItems}
                    value={newProviderId}
                    onValueChange={(value) => {
                      setNewProviderId(value ?? "")
                      setNewProviderApiKey("")
                    }}
                  >
                    <SelectTrigger
                      aria-label={t.settings.provider}
                      className="ousia-squircle-corners mt-2 w-full rounded-xl border-[0.5px] border-foreground/10 bg-white hover:bg-white"
                    >
                      <SelectValue placeholder={t.settings.chooseProvider} />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {addableProviders.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {provider.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>

                <label className="mt-4 block">
                  <span className="text-xs font-medium text-muted-foreground">
                    API Key
                  </span>
                  <Input
                    aria-label="API Key"
                    className="ousia-squircle-corners mt-2 rounded-xl border-[0.5px] border-foreground/10 bg-white focus-visible:bg-white disabled:cursor-default disabled:bg-neutral-50 disabled:text-neutral-500 disabled:opacity-100"
                    value={newProviderApiKey}
                    onChange={(event) =>
                      setNewProviderApiKey(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && canAddProvider) {
                        event.preventDefault()
                        void addProvider()
                      }
                    }}
                    placeholder="sk-..."
                    type="password"
                  />
                  {!newProviderApiKey.trim() ? (
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t.settings.apiKeyRequired}
                    </span>
                  ) : null}
                </label>

                <DialogFooter className="mt-5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ousia-squircle-corners h-10 rounded-2xl border-[0.5px] border-foreground/10 bg-white px-5 text-neutral-950 hover:bg-neutral-50 active:scale-[0.96]"
                    onClick={() => setIsAddProviderDialogOpen(false)}
                  >
                    {t.app.cancel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="ousia-squircle-corners h-10 rounded-2xl bg-neutral-950 px-5 text-white hover:bg-neutral-800 active:scale-[0.96]"
                    disabled={!canAddProvider}
                    onClick={() => void addProvider()}
                  >
                    {t.app.add}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>

          <section className={settingsSectionClass}>
            <h2 className="text-sm font-semibold">{t.settings.advanced}</h2>
            <div className={settingsFieldClass}>
              <label className={settingsLabelClass}>
                {t.settings.defaultWorkDir}
              </label>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <Input
                  className="ousia-squircle-corners flex-1 rounded-xl border-[0.5px] border-foreground/10 bg-background/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] focus-visible:bg-background dark:bg-input/45 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] dark:focus-visible:bg-input/60"
                  value={draft.defaultWorkDir}
                  onChange={(event) =>
                    updateDraft({
                      defaultWorkDir: event.target.value,
                    })
                  }
                  onBlur={() => commitRequiredTextSetting("defaultWorkDir")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur()
                    }
                  }}
                  placeholder="~/Documents/Ousia"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ousia-squircle-corners h-9 rounded-xl border-[0.5px] border-foreground/10 bg-background/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)] hover:bg-background dark:bg-input/45 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] dark:hover:bg-input/60"
                  onClick={chooseDefaultWorkDir}
                >
                  <FolderOpen size={18} />
                  {t.settings.choose}
                </Button>
              </div>
              <div className={settingsHelpClass}>
                {t.settings.defaultWorkDirHelp}
              </div>
            </div>
            <div className={settingsFieldClass}>
              <div className="flex items-center justify-between gap-3">
                <span className={settingsLabelClass}>
                  {t.settings.autoRetryOnFailure}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.autoRetryOnFailure}
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    draft.autoRetryOnFailure ? "bg-foreground" : "bg-muted"
                  )}
                  onClick={() =>
                    applySettings({
                      autoRetryOnFailure: !draft.autoRetryOnFailure,
                    })
                  }
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-[left]",
                      draft.autoRetryOnFailure ? "left-[18px]" : "left-0.5"
                    )}
                  />
                </button>
              </div>
              <div className={settingsHelpClass}>
                {t.settings.autoRetryOnFailureHelp}
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
