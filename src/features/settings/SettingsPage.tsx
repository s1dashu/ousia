import {
  Children,
  Fragment,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  Ban,
  Check,
  Eye,
  EyeOff,
  FolderOpen,
  Plus,
  Trash2,
} from "@/components/icons/huge-icons"

import { getMessages, languageOptions } from "@/app/i18n"
import { getConfiguredModelPresets, providerLabel } from "@/app/model-presets"
import type { AppSettings } from "@/app/app-state"
import { useTheme, type Theme } from "@/components/theme-provider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Card } from "@/features/settings/SettingsCard"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/settings/SettingsDialog"
import { Button } from "@/features/settings/SettingsButton"
import { Input } from "@/features/settings/SettingsInput"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/features/settings/SettingsSelect"
import { Switch } from "@/features/settings/SettingsSwitch"
import { SETTINGS_PANEL_SURFACE_CLASS } from "@/features/settings/settings-local-styles"
import { MAIN_PANEL_LEFT_CORNERS_CLASS } from "@/features/shell/main-panel-styles"
import {
  normalizeOusiaAppSettings,
  type OusiaAgentMode,
  type OusiaAgentProvider,
  type OusiaAppearanceColorScale,
  type OusiaChatContentWidth,
  type OusiaChatFontSize,
  type OusiaChatLineSpacing,
  type OusiaChatMessageSpacing,
  type OusiaCodexEnvironmentStatus,
  type OusiaFontFamily,
  type OusiaLanguage,
  type OusiaModelRegistryResult,
  type OusiaSendDuringRunMode,
} from "@/electron/chat-types"
import { cn } from "@/lib/utils"
import type { SettingsSectionId } from "@/features/settings/settings-navigation"

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
  activeSection: SettingsSectionId
  codexEnvironment: OusiaCodexEnvironmentStatus | undefined
  codexEnvironmentLoading: boolean
  modelRegistry: OusiaModelRegistryResult | undefined
  onRefreshCodexEnvironment: () => Promise<
    OusiaCodexEnvironmentStatus | undefined
  >
  onRefreshModelRegistry: () => Promise<OusiaModelRegistryResult | undefined>
  onSettingsChange: (settings: AppSettings) => void
  settings: AppSettings
}

const settingsContentClass = "mx-auto grid w-full max-w-[52rem] gap-6 pb-12"
const settingsSelectTriggerClass = "w-full @min-[720px]:w-52"

function SettingsGroup({
  children,
  description,
  title,
}: {
  children: ReactNode
  description?: ReactNode
  title: ReactNode
}) {
  const rows = Children.toArray(children)

  return (
    <section className="grid gap-2.5">
      <div className="grid gap-1 px-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? (
          <div className="text-sm leading-5 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <Card data-slot="settings-group-card" size="sm" className="gap-0 py-0">
        {rows.map((row, index) => (
          <Fragment key={(row as { key?: string }).key ?? index}>
            {index > 0 ? (
              <div aria-hidden="true" className="h-px w-full bg-border/50" />
            ) : null}
            {row}
          </Fragment>
        ))}
      </Card>
    </section>
  )
}

function SettingsRow({
  className,
  control,
  controlClassName,
  description,
  title,
}: {
  className?: string
  control: ReactNode
  controlClassName?: string
  description?: ReactNode
  title: ReactNode
}) {
  return (
    <div
      className={cn(
        "grid min-h-16 grid-cols-1 items-center gap-3 px-4 py-3.5 @min-[720px]:grid-cols-[minmax(0,1fr)_auto] @min-[720px]:gap-6",
        className
      )}
    >
      <div className="min-w-0">
        <div className="text-sm leading-5 font-medium text-foreground">
          {title}
        </div>
        {description ? (
          <div className="mt-0.5 text-sm leading-5 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div
        className={cn(
          "min-w-0 @min-[720px]:justify-self-end",
          controlClassName
        )}
      >
        {control}
      </div>
    </div>
  )
}

type ProviderRow = {
  apiKey: string
  authLabel?: string
  authSource?: NonNullable<
    OusiaModelRegistryResult["configuredProviders"][number]["authSource"]
  >
  id: string
  isDisabled: boolean
}

function SettingsPageComponent({
  activeSection,
  codexEnvironment,
  codexEnvironmentLoading,
  modelRegistry,
  onRefreshCodexEnvironment,
  onRefreshModelRegistry,
  onSettingsChange,
  settings,
}: SettingsPageProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
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
  const chatFontSizeOptions: Array<{
    label: string
    value: OusiaChatFontSize
  }> = [
    { label: t.settings.chatFontSizeSmall, value: "small" },
    { label: t.settings.chatFontSizeStandard, value: "standard" },
    { label: t.settings.chatFontSizeLarge, value: "large" },
    { label: t.settings.chatFontSizeExtraLarge, value: "extraLarge" },
  ]
  const chatLineSpacingOptions: Array<{
    label: string
    value: OusiaChatLineSpacing
  }> = [
    { label: t.settings.spacingCompact, value: "compact" },
    { label: t.settings.spacingStandard, value: "standard" },
    { label: t.settings.spacingRelaxed, value: "relaxed" },
  ]
  const chatMessageSpacingOptions: Array<{
    label: string
    value: OusiaChatMessageSpacing
  }> = chatLineSpacingOptions

  useEffect(() => {
    queueMicrotask(() => setDraft(settings))
  }, [settings])

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [activeSection])

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

  function commitRequiredTextSetting(
    key: "defaultSessionDir" | "defaultProjectCreationDir"
  ) {
    const value = draft[key].trim()
    if (!value) {
      updateDraft({ [key]: settings[key] })
      return
    }
    applySettings({ [key]: value })
  }

  async function chooseDefaultDirectory(
    key: "defaultSessionDir" | "defaultProjectCreationDir",
    prompt: string
  ) {
    if (!window.ousia) {
      const rawPath = window.prompt(prompt, draft[key])
      if (!rawPath?.trim()) {
        return
      }
      applySettings({ [key]: rawPath.trim() })
      return
    }
    const result = await window.ousia.selectDirectory({
      defaultPath: draft[key],
    })
    if (result.canceled) {
      return
    }
    applySettings({ [key]: result.path })
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
  const codexStatus = codexEnvironmentLoading
    ? {
        description: t.settings.codexDownloadingHelp,
        label: t.settings.codexDownloading,
      }
    : !codexEnvironment
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
  const sectionTitle =
    activeSection === "general"
      ? t.settings.general
      : activeSection === "appearance"
        ? t.settings.appearance
        : activeSection === "conversation"
          ? t.settings.conversationSettings
          : draft.defaultAgentProvider === "pi"
            ? t.settings.piSettings
            : t.settings.codexSettings

  return (
    <section
      className={cn(
        "ousia-main-panel @container/settings flex min-w-0 flex-1 flex-col overflow-hidden",
        MAIN_PANEL_LEFT_CORNERS_CLASS,
        SETTINGS_PANEL_SURFACE_CLASS
      )}
    >
      <div className="window-drag h-10 shrink-0" />
      <div
        ref={scrollContainerRef}
        className="ousia-hover-scrollbar min-h-0 flex-1 overflow-auto px-4 pt-4 @min-[720px]:px-8"
      >
        <div className={settingsContentClass}>
          <header className="px-1 pb-2">
            <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight text-foreground">
              {sectionTitle}
            </h1>
          </header>

          {activeSection === "general" ? (
            <>
              <SettingsGroup title={t.settings.agentHarness}>
                <SettingsRow
                  title={t.settings.defaultAgent}
                  description={t.settings.defaultAgentHelp}
                  control={
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
                        aria-label={t.settings.agentHarness}
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          <SelectItem value="pi">
                            {t.settings.piAgent}
                          </SelectItem>
                          <SelectItem value="codex">
                            {t.settings.codexAgent}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
              </SettingsGroup>

              <SettingsGroup title={t.settings.languageAndRegion}>
                <SettingsRow
                  title={t.settings.language}
                  description={t.settings.languageHelp}
                  control={
                    <Select
                      items={languageOptions}
                      value={draft.language}
                      onValueChange={(value) =>
                        applySettings({ language: value as OusiaLanguage })
                      }
                    >
                      <SelectTrigger
                        aria-label={t.settings.language}
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {languageOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
              </SettingsGroup>

              <SettingsGroup title={t.settings.defaultCreationPaths}>
                <SettingsRow
                  title={t.settings.defaultSessionDir}
                  description={t.settings.defaultSessionDirHelp}
                  controlClassName="w-full @min-[720px]:w-[26rem]"
                  control={
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                      <Input
                        value={draft.defaultSessionDir}
                        onChange={(event) =>
                          updateDraft({ defaultSessionDir: event.target.value })
                        }
                        onBlur={() =>
                          commitRequiredTextSetting("defaultSessionDir")
                        }
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
                        onClick={() =>
                          chooseDefaultDirectory(
                            "defaultSessionDir",
                            t.settings.defaultSessionDirPrompt
                          )
                        }
                      >
                        <FolderOpen size={16} />
                        {t.settings.choose}
                      </Button>
                    </div>
                  }
                />
                <SettingsRow
                  title={t.settings.defaultProjectCreationDir}
                  description={t.settings.defaultProjectCreationDirHelp}
                  controlClassName="w-full @min-[720px]:w-[26rem]"
                  control={
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                      <Input
                        value={draft.defaultProjectCreationDir}
                        onChange={(event) =>
                          updateDraft({
                            defaultProjectCreationDir: event.target.value,
                          })
                        }
                        onBlur={() =>
                          commitRequiredTextSetting("defaultProjectCreationDir")
                        }
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
                        onClick={() =>
                          chooseDefaultDirectory(
                            "defaultProjectCreationDir",
                            t.settings.defaultProjectCreationDirPrompt
                          )
                        }
                      >
                        <FolderOpen size={16} />
                        {t.settings.choose}
                      </Button>
                    </div>
                  }
                />
              </SettingsGroup>
            </>
          ) : null}

          {activeSection === "appearance" ? (
            <>
              <SettingsGroup title={t.settings.interface}>
                <SettingsRow
                  title={t.settings.appearanceMode}
                  description={t.settings.appearanceModeHelp}
                  control={
                    <Select
                      items={themeOptions}
                      value={draft.theme}
                      onValueChange={(value) =>
                        applyThemeSetting(value as Theme)
                      }
                    >
                      <SelectTrigger
                        aria-label={t.settings.appearanceMode}
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {themeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  title={t.settings.colorScale}
                  description={
                    selectedColorScaleDescription
                      ? `${t.settings.colorScaleHelp} ${selectedColorScaleDescription}`
                      : t.settings.colorScaleHelp
                  }
                  control={
                    <Select
                      items={appearanceColorScales}
                      value={draft.appearanceColorScale}
                      onValueChange={(value) =>
                        applySettings({
                          appearanceColorScale:
                            value as OusiaAppearanceColorScale,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={t.settings.colorScale}
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {appearanceColorScales.map((scale) => (
                            <SelectItem key={scale.value} value={scale.value}>
                              {scale.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
              </SettingsGroup>

              <SettingsGroup title={t.settings.typographyAndLayout}>
                <SettingsRow
                  title={t.settings.appFontFamily}
                  description={t.settings.appFontFamilyHelp}
                  control={
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
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {fontFamilyOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  title={t.settings.chatFontFamily}
                  description={t.settings.chatFontFamilyHelp}
                  control={
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
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {fontFamilyOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  title={t.settings.chatContentWidth}
                  description={t.settings.chatContentWidthHelp}
                  control={
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
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {chatContentWidthOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  title={t.settings.chatFontSize}
                  description={t.settings.chatFontSizeHelp}
                  control={
                    <Select
                      items={chatFontSizeOptions}
                      value={draft.chatFontSize}
                      onValueChange={(value) =>
                        applySettings({
                          chatFontSize: value as OusiaChatFontSize,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={t.settings.chatFontSize}
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {chatFontSizeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  title={t.settings.chatLineSpacing}
                  description={t.settings.chatLineSpacingHelp}
                  control={
                    <Select
                      items={chatLineSpacingOptions}
                      value={draft.chatLineSpacing}
                      onValueChange={(value) =>
                        applySettings({
                          chatLineSpacing: value as OusiaChatLineSpacing,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={t.settings.chatLineSpacing}
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {chatLineSpacingOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  title={t.settings.chatMessageSpacing}
                  description={t.settings.chatMessageSpacingHelp}
                  control={
                    <Select
                      items={chatMessageSpacingOptions}
                      value={draft.chatMessageSpacing}
                      onValueChange={(value) =>
                        applySettings({
                          chatMessageSpacing: value as OusiaChatMessageSpacing,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={t.settings.chatMessageSpacing}
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {chatMessageSpacingOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
              </SettingsGroup>
            </>
          ) : null}

          {activeSection === "conversation" ? (
            <SettingsGroup title={t.settings.conversationBehavior}>
              <SettingsRow
                title={t.settings.appendMessages}
                description={t.settings.appendMessagesHelp}
                control={
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
                      className={settingsSelectTriggerClass}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" position="popper">
                      <SelectGroup>
                        {sendDuringRunModeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
              <SettingsRow
                title={t.settings.showContextUsage}
                description={t.settings.showContextUsageHelp}
                control={
                  <Switch
                    aria-label={t.settings.showContextUsage}
                    checked={draft.showContextUsage}
                    onCheckedChange={(checked) =>
                      applySettings({ showContextUsage: checked })
                    }
                  />
                }
              />
              <SettingsRow
                title={t.settings.continueQueuedAfterInterrupt}
                description={t.settings.continueQueuedAfterInterruptHelp}
                control={
                  <Switch
                    aria-label={t.settings.continueQueuedAfterInterrupt}
                    checked={draft.continueQueuedMessagesAfterInterrupt}
                    onCheckedChange={(checked) =>
                      applySettings({
                        continueQueuedMessagesAfterInterrupt: checked,
                      })
                    }
                  />
                }
              />
            </SettingsGroup>
          ) : null}

          {activeSection === "provider" &&
          draft.defaultAgentProvider === "pi" ? (
            <>
              <SettingsGroup title={t.settings.permissions}>
                <SettingsRow
                  title={t.settings.agentMode}
                  description={
                    agentModeOptions.find(
                      (option) => option.value === draft.agentMode
                    )?.description
                  }
                  control={
                    <Select
                      items={agentModeOptions}
                      value={draft.agentMode}
                      onValueChange={(value) =>
                        applySettings({ agentMode: value as OusiaAgentMode })
                      }
                    >
                      <SelectTrigger
                        aria-label={t.settings.agentMode}
                        className={settingsSelectTriggerClass}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
                        <SelectGroup>
                          {agentModeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  }
                />
              </SettingsGroup>

              <SettingsGroup
                title={t.settings.model}
                description={t.settings.piModelProvidersHelp}
              >
                <SettingsRow
                  title={t.settings.providerKeys}
                  description={t.settings.addProviderDescription}
                  control={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!addableProviders.length}
                      onClick={openAddProviderDialog}
                    >
                      <Plus size={16} />
                      {t.app.add}
                    </Button>
                  }
                />
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
                      className="grid min-w-0 items-center gap-3 px-4 py-3.5 @min-[720px]:grid-cols-[minmax(0,10rem)_minmax(12rem,1fr)_auto]"
                    >
                      <div
                        className={cn(
                          "flex min-w-0 items-center gap-2 text-sm font-medium text-foreground",
                          provider.isDisabled && "text-muted-foreground"
                        )}
                      >
                        <span className="truncate">
                          {providerLabel(modelRegistry, provider.id)}
                        </span>
                        {provider.isDisabled ? (
                          <span className="shrink-0 rounded-xl bg-muted px-2 py-0.5 text-xs leading-4 font-medium text-muted-foreground">
                            {t.settings.disabled}
                          </span>
                        ) : null}
                      </div>
                      <div className="relative min-w-0">
                        <Input
                          aria-label={`${provider.id} API Key`}
                          className="pr-10"
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
                            className="absolute top-1/2 right-0.5 -translate-y-1/2"
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
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </Button>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${
                                  provider.isDisabled
                                    ? t.settings.enableProvider
                                    : t.settings.disableProvider
                                } ${provider.id}`}
                                disabled={isProviderSaving}
                                onClick={() => toggleProviderDisabled(provider)}
                              >
                                {provider.isDisabled ? (
                                  <Check size={16} />
                                ) : (
                                  <Ban size={16} />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {provider.isDisabled
                                ? t.settings.enableProvider
                                : t.settings.disableProvider}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${t.app.delete} ${provider.id}`}
                                disabled={isProviderSaving}
                                onClick={() => void deleteProvider(provider)}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {t.app.delete}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  )
                })}
                {providerError ? (
                  <div
                    role="alert"
                    className="bg-red-50 px-4 py-3 text-sm leading-5 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {providerError}
                  </div>
                ) : null}
              </SettingsGroup>

              <SettingsGroup title={t.settings.reliability}>
                <SettingsRow
                  title={t.settings.autoRetryOnFailure}
                  description={t.settings.autoRetryOnFailureHelp}
                  control={
                    <Switch
                      aria-label={t.settings.autoRetryOnFailure}
                      checked={draft.autoRetryOnFailure}
                      onCheckedChange={(checked) =>
                        applySettings({ autoRetryOnFailure: checked })
                      }
                    />
                  }
                />
              </SettingsGroup>

              <Dialog
                open={isAddProviderDialogOpen}
                onOpenChange={setIsAddProviderDialogOpen}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t.settings.addProvider}</DialogTitle>
                    <DialogDescription>
                      {t.settings.addProviderDescription}
                    </DialogDescription>
                  </DialogHeader>

                  <label className="mt-4 block">
                    <span className="text-sm font-medium">
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
                        className="mt-2 w-full"
                      >
                        <SelectValue placeholder={t.settings.chooseProvider} />
                      </SelectTrigger>
                      <SelectContent align="start" position="popper">
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
                    <span className="text-sm font-medium">API Key</span>
                    <Input
                      aria-label="API Key"
                      className="mt-2"
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

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsAddProviderDialogOpen(false)}
                    >
                      {t.app.cancel}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!canAddProvider}
                      onClick={() => void addProvider()}
                    >
                      {t.app.add}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : null}

          {activeSection === "provider" &&
          draft.defaultAgentProvider === "codex" ? (
            <SettingsGroup title={t.settings.codexAuthentication}>
              <SettingsRow
                title={codexStatus.label}
                description={
                  <div aria-live="polite">
                    <span>{codexStatus.description}</span>
                    {codexError ? (
                      <span
                        role="alert"
                        className="mt-1 block text-red-600 dark:text-red-400"
                      >
                        {codexError}
                      </span>
                    ) : null}
                  </div>
                }
                control={
                  !codexEnvironment || !codexEnvironment.available ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={codexAction !== null || codexEnvironmentLoading}
                      onClick={() => void refreshCodexStatus()}
                    >
                      {codexAction === "refresh" || codexEnvironmentLoading
                        ? t.settings.downloadingCodex
                        : codexEnvironment
                          ? t.settings.retryCodexCheck
                          : t.settings.checkCodex}
                    </Button>
                  ) : codexAccount ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={codexAction !== null || codexEnvironmentLoading}
                      onClick={() => void runCodexAuthAction("logout")}
                    >
                      {codexAction === "logout"
                        ? t.settings.signingOutCodex
                        : t.settings.signOutCodex}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={codexAction !== null || codexEnvironmentLoading}
                      onClick={() => void runCodexAuthAction("login")}
                    >
                      {codexAction === "login"
                        ? t.settings.signingInCodex
                        : t.settings.signInCodex}
                    </Button>
                  )
                }
              />
            </SettingsGroup>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export const SettingsPage = memo(SettingsPageComponent)
