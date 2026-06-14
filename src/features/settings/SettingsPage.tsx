import { useEffect, useState } from "react"
import { FolderOpen, Plus, Trash2, X } from "lucide-react"

import { getMessages, languageOptions } from "@/app/i18n"
import { modelsForProvider, providerLabel } from "@/app/model-presets"
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
  type OusiaAppearanceColorScale,
  type OusiaLanguage,
  type OusiaModelRegistryResult,
  type OusiaSendDuringRunMode,
} from "@/electron/chat-types"

const appearanceColorScales: Array<{
  label: string
  value: OusiaAppearanceColorScale
  description: string
}> = [
  { label: "Tea", value: "tea", description: "" },
  { label: "Sand", value: "sand", description: "" },
  { label: "Gray", value: "gray", description: "" },
  { label: "Slate", value: "slate", description: "" },
  { label: "Mauve", value: "mauve", description: "" },
  { label: "Sage", value: "sage", description: "" },
  { label: "Olive", value: "olive", description: "" },
  { label: "Tomato", value: "tomato", description: "" },
  { label: "Red", value: "red", description: "" },
  { label: "Ruby", value: "ruby", description: "" },
  { label: "Crimson", value: "crimson", description: "" },
  { label: "Pink", value: "pink", description: "" },
  { label: "Plum", value: "plum", description: "" },
  { label: "Purple", value: "purple", description: "" },
  { label: "Violet", value: "violet", description: "" },
  { label: "Iris", value: "iris", description: "" },
  { label: "Indigo", value: "indigo", description: "" },
  { label: "Blue", value: "blue", description: "" },
  { label: "Cyan", value: "cyan", description: "" },
  { label: "Teal", value: "teal", description: "" },
  { label: "Jade", value: "jade", description: "" },
  { label: "Green", value: "green", description: "" },
  { label: "Grass", value: "grass", description: "" },
  { label: "Brown", value: "brown", description: "" },
  { label: "Orange", value: "orange", description: "" },
  { label: "Amber", value: "amber", description: "" },
  { label: "Yellow", value: "yellow", description: "" },
  { label: "Lime", value: "lime", description: "" },
  { label: "Mint", value: "mint", description: "" },
  { label: "Sky", value: "sky", description: "" },
]

type SettingsPageProps = {
  modelRegistry: OusiaModelRegistryResult | undefined
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => void
  settings: AppSettings
}

export function SettingsPage({
  modelRegistry,
  onClose,
  onSettingsChange,
  settings,
}: SettingsPageProps) {
  const [draft, setDraft] = useState(settings)
  const [isAddProviderDialogOpen, setIsAddProviderDialogOpen] = useState(false)
  const [newProviderId, setNewProviderId] = useState("")
  const [newProviderApiKey, setNewProviderApiKey] = useState("")
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
    { label: t.settings.steer, value: "steer" },
    { label: t.settings.queue, value: "queue" },
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
    const result = await window.ousia.selectDirectory()
    if (result.canceled) {
      return
    }
    applySettings({ defaultWorkDir: result.path })
  }

  function addProvider() {
    const id = newProviderId.trim()
    const provider = modelRegistry?.providers.find((item) => item.id === id)
    if (
      !provider ||
      settings.modelProviders.some((configured) => configured.id === id)
    ) {
      return
    }
    const nextModelId = provider.models[0]?.modelId || settings.modelId
    applySettings({
      modelProvider: id,
      modelId: nextModelId,
      modelProviders: [
        ...settings.modelProviders,
        {
          id,
          apiKey: newProviderApiKey.trim(),
        },
      ],
    })
    setNewProviderId("")
    setNewProviderApiKey("")
    setIsAddProviderDialogOpen(false)
  }

  function updateProviderDraft(providerId: string, apiKey: string) {
    const nextModelProviders = draft.modelProviders.map((provider) =>
      provider.id === providerId ? { ...provider, apiKey } : provider
    )
    updateDraft({
      modelProviders: nextModelProviders,
    })
    applySettings({
      modelProviders: nextModelProviders,
    })
  }

  function commitProviderApiKey(providerId: string) {
    const draftProvider = draft.modelProviders.find(
      (provider) => provider.id === providerId
    )
    if (!draftProvider) {
      return
    }
    applySettings({
      modelProviders: settings.modelProviders.map((provider) =>
        provider.id === providerId
          ? { ...provider, apiKey: draftProvider.apiKey.trim() }
          : provider
      ),
    })
  }

  function deleteProvider(providerId: string) {
    if (settings.modelProviders.length <= 1) {
      return
    }
    const nextProviders = settings.modelProviders.filter(
      (provider) => provider.id !== providerId
    )
    const nextProviderId =
      settings.modelProvider === providerId
        ? (nextProviders[0]?.id ?? settings.modelProvider)
        : settings.modelProvider
    const nextProviderModel = modelsForProvider(
      modelRegistry,
      nextProviderId
    ).find((model) => model.modelId === settings.modelId)
    const nextDefaultModel = modelsForProvider(modelRegistry, nextProviderId)[0]
    applySettings({
      modelProviders: nextProviders,
      modelProvider: nextProviderId,
      modelId:
        nextProviderModel?.modelId ?? nextDefaultModel?.modelId ?? settings.modelId,
    })
  }

  const addableProviders =
    modelRegistry?.providers.filter(
      (provider) =>
        provider.models.length > 0 &&
        !draft.modelProviders.some((configured) => configured.id === provider.id)
    ) ?? []
  const addableProviderSelectItems = addableProviders.map((provider) => ({
    label: provider.name,
    value: provider.id,
  }))
  const canAddProvider = addableProviders.some(
    (provider) => provider.id === newProviderId
  )

  function openAddProviderDialog() {
    setNewProviderId(addableProviders[0]?.id ?? "")
    setNewProviderApiKey("")
    setIsAddProviderDialogOpen(true)
  }

  const selectedColorScaleDescription = appearanceColorScales.find(
    (scale) => scale.value === draft.appearanceColorScale
  )?.description

  return (
    <section className="@container/settings flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--ousia-panel-radius)] border border-border/60 bg-white dark:bg-card">
      <header className="window-drag grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b pr-4 pl-4">
        <div className="window-drag flex min-w-0 items-center self-stretch">
          <h1 className="window-drag truncate text-sm leading-none font-normal">
            {t.app.settings}
          </h1>
        </div>
        <div className="window-drag flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="window-no-drag size-6 rounded-md"
            aria-label={t.app.close}
            onClick={onClose}
          >
            <X size={18} />
          </Button>
        </div>
      </header>
      <div className="ousia-hover-scrollbar min-h-0 flex-1 overflow-auto px-8 py-7">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
          <section>
            <h2 className="text-sm font-semibold">{t.settings.general}</h2>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">
              {t.settings.defaultWorkDir}
            </label>
            <div className="mt-2 flex items-center gap-2">
              <Input
                className="flex-1 rounded-md bg-card/40"
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
                placeholder="~/.ousia/workspace"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 rounded-md"
                onClick={chooseDefaultWorkDir}
              >
                <FolderOpen size={18} />
                {t.settings.choose}
              </Button>
            </div>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              {t.settings.defaultWorkDirHelp}
            </div>
            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                {t.settings.language}
              </span>
              <Select
                items={languageOptions}
                value={draft.language}
                onValueChange={(value) =>
                  applySettings({ language: value as OusiaLanguage })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.language}
                  className="mt-2 w-full rounded-md"
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

          <section>
            <h2 className="text-sm font-semibold">{t.settings.appearance}</h2>
            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                {t.settings.appearanceMode}
              </span>
              <Select
                items={themeOptions}
                value={draft.theme}
                onValueChange={(value) => applyThemeSetting(value as Theme)}
              >
                <SelectTrigger
                  aria-label={t.settings.appearanceMode}
                  className="mt-2 w-full rounded-md"
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

            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
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
                  className="mt-2 w-full rounded-md"
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
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {selectedColorScaleDescription}
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="text-sm font-semibold">{t.settings.agent}</h2>
            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
                {t.settings.agentMode}
              </span>
              <Select
                items={agentModeOptions}
                value={draft.agentMode}
                onValueChange={(value) =>
                  applySettings({ agentMode: value as OusiaAgentMode })
                }
              >
                <SelectTrigger
                  aria-label={t.settings.agentMode}
                  className="mt-2 w-full rounded-md"
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
              <div className="mt-2 text-xs leading-5 text-muted-foreground">
                {
                  agentModeOptions.find(
                    (option) => option.value === draft.agentMode
                  )?.description
                }
              </div>
            </div>
            <div className="mt-4">
              <span className="text-xs font-medium text-muted-foreground">
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
                  className="mt-2 w-full rounded-md"
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
          </section>

          <section>
            <h2 className="text-sm font-semibold">{t.settings.model}</h2>
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t.settings.providerKeys}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="border-transparent bg-muted/45 hover:bg-muted/60 active:scale-[0.96]"
                  disabled={!addableProviders.length}
                  onClick={openAddProviderDialog}
                >
                  <Plus size={18} />
                  {t.app.add}
                </Button>
              </div>
              <div className="mt-3 -mx-1 flex min-w-0 flex-col gap-2 px-1 py-1">
                {draft.modelProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_40px] items-center gap-x-3 gap-y-2 py-1 @min-[560px]:grid-cols-[minmax(0,160px)_minmax(0,1fr)_40px]"
                  >
                    <div className="flex h-9 min-w-0 items-center text-sm font-medium text-foreground/75">
                      <span className="block truncate">
                        {providerLabel(modelRegistry, provider.id)}
                      </span>
                    </div>
                    <Input
                      aria-label={`${provider.id} API Key`}
                      className="min-w-0 rounded-md border-transparent bg-background/85 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.03)] focus-visible:bg-background dark:bg-input/45 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] dark:focus-visible:bg-input/60 @max-[559px]:col-span-1"
                      value={provider.apiKey}
                      onChange={(event) =>
                        updateProviderDraft(provider.id, event.target.value)
                      }
                      onBlur={() => commitProviderApiKey(provider.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur()
                        }
                      }}
                      placeholder="sk-..."
                      type="password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="justify-self-end text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
                      aria-label={`${t.app.delete} ${provider.id}`}
                      disabled={draft.modelProviders.length <= 1}
                      onClick={() => deleteProvider(provider.id)}
                    >
                      <Trash2 size={18} />
                    </Button>
                  </div>
                ))}
              </div>
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
                    className="text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
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
                    onValueChange={(value) => setNewProviderId(value ?? "")}
                  >
                    <SelectTrigger
                      aria-label={t.settings.provider}
                      className="mt-2 w-full rounded-md border-transparent bg-muted/45 hover:bg-muted/60"
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
                    className="mt-2 rounded-md border-transparent bg-muted/45 focus-visible:bg-background"
                    value={newProviderApiKey}
                    onChange={(event) =>
                      setNewProviderApiKey(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && canAddProvider) {
                        event.preventDefault()
                        addProvider()
                      }
                    }}
                    placeholder="sk-..."
                    type="password"
                  />
                </label>

                <DialogFooter className="mt-5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="active:scale-[0.96]"
                    onClick={() => setIsAddProviderDialogOpen(false)}
                  >
                    {t.app.cancel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="active:scale-[0.96]"
                    disabled={!canAddProvider}
                    onClick={addProvider}
                  >
                    {t.app.add}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>
        </div>
      </div>
    </section>
  )
}
