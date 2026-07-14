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
  FolderOpen,
  LoaderCircle,
} from "@/components/icons/huge-icons"

import { getMessages, languageOptions } from "@/app/i18n"
import { getConfiguredModelPresets, providerLabel } from "@/app/model-presets"
import type { AppSettings } from "@/app/app-state"
import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { useTheme, type Theme } from "@/components/theme-provider"
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
  type OusiaAppearanceColorScale,
  type OusiaChatContentWidth,
  type OusiaChatFontSize,
  type OusiaChatLineSpacing,
  type OusiaChatMessageSpacing,
  type OusiaLanguage,
  type OusiaModelRegistryResult,
  type OusiaPiEnvironmentStatus,
  type OusiaSendDuringRunMode,
} from "@/electron/chat-types"
import { cn } from "@/lib/utils"
import type { SettingsSectionId } from "@/features/settings/settings-navigation"
import { ArchivedSessionsSettings } from "@/features/settings/ArchivedSessionsSettings"

const appearanceColorScales: Array<{
  label: string
  value: OusiaAppearanceColorScale
  description: string
}> = [
  {
    label: "Mist",
    value: "mist",
    description: "Default · near-white sidebar with a soft sky-blue slate tint",
  },
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
  modelRegistry: OusiaModelRegistryResult | undefined
  onDeleteArchivedSessions: (sessionIds: string[]) => Promise<void>
  onRefreshModelRegistry: () => Promise<OusiaModelRegistryResult | undefined>
  onSettingsChange: (settings: AppSettings) => void
  onRestoreArchivedSessions: (sessionIds: string[]) => Promise<void>
  projects: ProjectRecord[]
  sessions: SessionRecord[]
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
  id: string
  isDisabled: boolean
  modelCount: number
}

function SettingsPageComponent({
  activeSection,
  modelRegistry,
  onDeleteArchivedSessions,
  onRefreshModelRegistry,
  onSettingsChange,
  onRestoreArchivedSessions,
  projects,
  sessions,
  settings,
}: SettingsPageProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(settings)
  const [piEnvironment, setPiEnvironment] =
    useState<OusiaPiEnvironmentStatus>()
  const [runtimeConfirmation, setRuntimeConfirmation] = useState<
    "install" | "uninstall" | null
  >(null)
  const [runtimeOperation, setRuntimeOperation] = useState<
    "install" | "path" | "select" | "uninstall" | null
  >(null)
  const [runtimeError, setRuntimeError] = useState("")
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

  useEffect(() => {
    if (activeSection !== "provider") return
    let canceled = false
    void window.ousia
      .checkPiEnvironment()
      .then((status) => {
        if (!canceled) setPiEnvironment(status)
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setRuntimeError(
            error instanceof Error ? error.message : String(error)
          )
        }
      })
    return () => {
      canceled = true
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

  function toggleProviderDisabled(provider: ProviderRow) {
    const providerId = provider.id
    const nextDisabledProviderIds = provider.isDisabled
      ? settings.disabledModelProviderIds.filter((id) => id !== providerId)
      : [...settings.disabledModelProviderIds, providerId]
    applySettings({
      disabledModelProviderIds: nextDisabledProviderIds,
      ...currentModelVisibilityPatch(
        settings.modelProviders,
        nextDisabledProviderIds
      ),
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
  const providerRows: ProviderRow[] = [...configuredProviderIds]
    .filter(Boolean)
    .map((providerId) => {
      return {
        id: providerId,
        isDisabled: disabledProviderIdSet.has(providerId),
        modelCount:
          modelRegistry?.providers.find((provider) => provider.id === providerId)
            ?.models.length ?? 0,
      }
    })
    .sort((left, right) =>
      providerLabel(modelRegistry, left.id).localeCompare(
        providerLabel(modelRegistry, right.id),
        undefined,
        { sensitivity: "base" }
      )
    )
  async function runRuntimeAction(
    operation: NonNullable<typeof runtimeOperation>,
    action: () => Promise<{
      canceled?: boolean
      error?: string
      ok: boolean
      status?: OusiaPiEnvironmentStatus
    }>
  ) {
    setRuntimeError("")
    setRuntimeOperation(operation)
    try {
      const result = await action()
      if (result.canceled) return
      if (!result.ok) {
        throw new Error(result.error ?? t.settings.piRuntimeActionFailed)
      }
      if (result.status) setPiEnvironment(result.status)
      await onRefreshModelRegistry()
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error))
    } finally {
      setRuntimeOperation(null)
      setRuntimeConfirmation(null)
    }
  }

  async function openPiConfigDirectory() {
    if (!piEnvironment?.configDirExists) return
    setRuntimeError("")
    try {
      await window.ousia.openDirectoryInFinder({
        path: piEnvironment.agentDir,
      })
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error))
    }
  }

  const selectedColorScaleDescription = appearanceColorScales.find(
    (scale) => scale.value === draft.appearanceColorScale
  )?.description
  const sectionTitle =
    activeSection === "general"
      ? t.settings.general
      : activeSection === "appearance"
        ? t.settings.appearance
        : activeSection === "conversation"
          ? t.settings.conversationSettings
          : activeSection === "archivedSessions"
            ? t.settings.archivedSessions
            : t.settings.piSettings

  return (
    <section
      className={cn(
        "ousia-main-panel @container/settings flex min-w-0 flex-1 flex-col overflow-hidden",
        MAIN_PANEL_LEFT_CORNERS_CLASS,
        SETTINGS_PANEL_SURFACE_CLASS
      )}
    >
      <div
        className="window-drag h-10 shrink-0"
        data-tauri-drag-region="deep"
      />
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
                        placeholder="~/pi"
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
                        placeholder="~/pi"
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

          {activeSection === "provider" ? (
            <>
              <SettingsGroup
                title={t.settings.piRuntime}
                description={t.settings.piRuntimeHelp}
              >
                <SettingsRow
                  title={
                    piEnvironment?.available
                      ? t.settings.piRuntimeReady
                      : t.settings.piRuntimeMissing
                  }
                  description={
                    piEnvironment?.available
                      ? `${piEnvironment.version ?? "Pi"} · ${piEnvironment.binaryPath}`
                      : piEnvironment?.error ?? t.settings.piRuntimeLoading
                  }
                  control={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {runtimeOperation ? (
                        <LoaderCircle className="animate-spin text-muted-foreground" size={16} />
                      ) : null}
                      {!piEnvironment?.available && piEnvironment?.canInstall ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={Boolean(runtimeOperation)}
                          onClick={() => setRuntimeConfirmation("install")}
                        >
                          {t.settings.installPi}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(runtimeOperation)}
                        onClick={() =>
                          void runRuntimeAction("select", () =>
                            window.ousia.selectPiBinary()
                          )
                        }
                      >
                        {t.settings.selectExistingPi}
                      </Button>
                      {piEnvironment?.isManagedInstall ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={Boolean(runtimeOperation)}
                          onClick={() => setRuntimeConfirmation("uninstall")}
                        >
                          {t.settings.uninstallPi}
                        </Button>
                      ) : null}
                    </div>
                  }
                />
                <SettingsRow
                  title={t.settings.localPiConfiguration}
                  description={
                    piEnvironment?.configDirExists
                      ? t.settings.localPiConfigurationFound(
                          piEnvironment.agentDir
                        )
                      : t.settings.localPiConfigurationMissing(
                          piEnvironment?.agentDir ?? "~/.pi/agent"
                        )
                  }
                  control={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!piEnvironment?.configDirExists}
                      onClick={() => void openPiConfigDirectory()}
                    >
                      <FolderOpen size={16} />
                      {t.settings.openPiConfiguration}
                    </Button>
                  }
                />
                <SettingsRow
                  title={t.settings.shellPath}
                  description={
                    piEnvironment?.isPathManaged
                      ? t.settings.shellPathManaged(
                          piEnvironment.pathLinkPath ?? "~/.local/bin/pi"
                        )
                      : piEnvironment?.isOnPath
                        ? t.settings.shellPathAlreadyAvailable
                        : t.settings.shellPathHelp
                  }
                  control={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        !piEnvironment?.available || Boolean(runtimeOperation)
                      }
                      onClick={() =>
                        void runRuntimeAction("path", () =>
                          piEnvironment?.isPathManaged
                            ? window.ousia.removePiFromShellPath()
                            : window.ousia.addPiToShellPath()
                        )
                      }
                    >
                      {piEnvironment?.isPathManaged
                        ? t.settings.removeFromShellPath
                        : t.settings.addToShellPath}
                    </Button>
                  }
                />
                {piEnvironment?.installPrerequisiteError ? (
                  <div
                    role="alert"
                    className="bg-amber-500/10 px-4 py-3 text-sm leading-5 text-amber-800 dark:text-amber-300"
                  >
                    {piEnvironment.installPrerequisiteError}
                  </div>
                ) : null}
                {runtimeError ? (
                  <div
                    role="alert"
                    className="bg-destructive/10 px-4 py-3 text-sm leading-5 text-destructive"
                  >
                    {runtimeError}
                  </div>
                ) : null}
              </SettingsGroup>

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
                {providerRows.length ? (
                  providerRows.map((provider) => (
                    <SettingsRow
                      key={provider.id}
                      title={providerLabel(modelRegistry, provider.id)}
                      description={t.settings.localPiProviderModels(
                        provider.modelCount
                      )}
                      control={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`${
                            provider.isDisabled
                              ? t.settings.enableProvider
                              : t.settings.disableProvider
                          } ${provider.id}`}
                          onClick={() => toggleProviderDisabled(provider)}
                        >
                          {provider.isDisabled ? (
                            <Check size={16} />
                          ) : (
                            <Ban size={16} />
                          )}
                          {provider.isDisabled
                            ? t.settings.enableProvider
                            : t.settings.disableProvider}
                        </Button>
                      }
                    />
                  ))
                ) : (
                  <SettingsRow
                    title={t.settings.noLocalPiProviders}
                    description={
                      modelRegistry?.error ?? t.settings.noLocalPiProvidersHelp
                    }
                    control={<span />}
                  />
                )}
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
                open={runtimeConfirmation !== null}
                onOpenChange={(open) => {
                  if (!open && !runtimeOperation) setRuntimeConfirmation(null)
                }}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {runtimeConfirmation === "uninstall"
                        ? t.settings.uninstallPi
                        : t.settings.installPi}
                    </DialogTitle>
                    <DialogDescription>
                      {runtimeConfirmation === "uninstall"
                        ? t.settings.uninstallPiConfirmation
                        : t.settings.installPiConfirmation}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(runtimeOperation)}
                      onClick={() => setRuntimeConfirmation(null)}
                    >
                      {t.app.cancel}
                    </Button>
                    <Button
                      type="button"
                      variant={
                        runtimeConfirmation === "uninstall"
                          ? "destructive"
                          : "default"
                      }
                      size="sm"
                      disabled={Boolean(runtimeOperation)}
                      onClick={() => {
                        if (runtimeConfirmation === "uninstall") {
                          void runRuntimeAction("uninstall", () =>
                            window.ousia.uninstallPiRuntime()
                          )
                        } else {
                          void runRuntimeAction("install", () =>
                            window.ousia.installPiRuntime()
                          )
                        }
                      }}
                    >
                      {runtimeOperation ? (
                        <LoaderCircle className="animate-spin" size={16} />
                      ) : null}
                      {runtimeConfirmation === "uninstall"
                        ? t.settings.uninstallPi
                        : t.settings.installPi}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : null}

          {activeSection === "archivedSessions" ? (
            <ArchivedSessionsSettings
              language={draft.language}
              projects={projects}
              sessions={sessions}
              onDelete={onDeleteArchivedSessions}
              onRestore={onRestoreArchivedSessions}
            />
          ) : null}

        </div>
      </div>
    </section>
  )
}

export const SettingsPage = memo(SettingsPageComponent)
