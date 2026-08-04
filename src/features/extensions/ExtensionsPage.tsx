import { useEffect, useMemo, useRef, useState } from "react"

import { getMessages } from "@/app/i18n"
import piPackagesTop100 from "@/electron/pi-packages-top100.json"
import { ArrowLeft, ChevronRight, Link } from "@/components/icons/nucleo-icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  OusiaInstalledSkill,
  OusiaLanguage,
} from "@/electron/chat-types"
import { CHAT_CONTENT_MAX_WIDTH_CLASS } from "@/features/chat/chat-layout"
import { MAIN_PANEL_LEFT_CORNERS_CLASS } from "@/features/shell/main-panel-styles"
import { cn } from "@/lib/utils"

const EXTENSIONS_PER_PAGE = 20
const ALLOWED_PACKAGE_TYPES = new Set<PiPackageType>([
  "extension",
  "package",
  "prompt",
  "skill",
  "theme",
])

type PiPackageType = "extension" | "package" | "prompt" | "skill" | "theme"
type PiPackageFilter = "all" | PiPackageType
type ExtensionsView = "explore" | "installed"
type PendingPackageOperation = {
  operation: "install" | "remove"
  packageName: string
  phase: "installing" | "reloading" | "removing"
}

type PiPackageCatalogItem = {
  rank: number
  name: string
  version: string
  description: string
  author: string
  monthlyDownloads: number
  types: PiPackageType[]
  publishedAt: string
  detailUrl: string
  npmUrl: string
  repositoryUrl: string | null
  installCommand: string
}

type PiPackageCatalogSnapshot = {
  schemaVersion: 1
  packages: PiPackageCatalogItem[]
}

type PiPackageDisplayItem = Omit<
  PiPackageCatalogItem,
  "detailUrl" | "monthlyDownloads"
> & {
  detailUrl: string | null
  installedSkill?: OusiaInstalledSkill
  monthlyDownloads: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isPiPackageType(value: unknown): value is PiPackageType {
  return (
    typeof value === "string" &&
    ALLOWED_PACKAGE_TYPES.has(value as PiPackageType)
  )
}

function isPiPackageFilter(value: unknown): value is PiPackageFilter {
  return value === "all" || isPiPackageType(value)
}

function isExtensionsView(value: unknown): value is ExtensionsView {
  return value === "explore" || value === "installed"
}

function assertPiPackageCatalog(
  value: unknown
): asserts value is PiPackageCatalogSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Unsupported Pi package catalog schema")
  }
  if (!Array.isArray(value.packages) || value.packages.length !== 100) {
    throw new Error("Pi package catalog must contain exactly 100 packages")
  }

  let previousDownloads = Number.POSITIVE_INFINITY
  value.packages.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Pi package at rank ${index + 1} is invalid`)
    }
    if (
      item.rank !== index + 1 ||
      typeof item.name !== "string" ||
      !item.name ||
      typeof item.version !== "string" ||
      typeof item.description !== "string" ||
      typeof item.author !== "string" ||
      typeof item.monthlyDownloads !== "number" ||
      !Number.isInteger(item.monthlyDownloads) ||
      item.monthlyDownloads < 0 ||
      !Array.isArray(item.types) ||
      !item.types.every(isPiPackageType) ||
      typeof item.publishedAt !== "string" ||
      Number.isNaN(Date.parse(item.publishedAt)) ||
      typeof item.detailUrl !== "string" ||
      !item.detailUrl.startsWith("https://pi.dev/packages/") ||
      typeof item.npmUrl !== "string" ||
      !item.npmUrl.startsWith("https://www.npmjs.com/package/") ||
      (item.repositoryUrl !== null &&
        (typeof item.repositoryUrl !== "string" ||
          !item.repositoryUrl.startsWith("https://github.com/"))) ||
      typeof item.installCommand !== "string"
    ) {
      throw new Error(`Pi package at rank ${index + 1} is invalid`)
    }
    if (item.monthlyDownloads > previousDownloads) {
      throw new Error("Pi package catalog is not sorted by downloads")
    }
    previousDownloads = item.monthlyDownloads
  })
}

const catalogData: unknown = piPackagesTop100
assertPiPackageCatalog(catalogData)
const PI_PACKAGES = catalogData.packages

function packageTypeLabel(
  type: PiPackageType,
  t: ReturnType<typeof getMessages>
) {
  switch (type) {
    case "extension":
      return t.extensions.extensionType
    case "package":
      return t.extensions.packageType
    case "prompt":
      return t.extensions.promptType
    case "skill":
      return t.extensions.skillType
    case "theme":
      return t.extensions.themeType
  }
}

function formatCompactDownloads(count: number) {
  if (count < 1_000) {
    return String(count)
  }
  return `${Number((count / 1_000).toFixed(1))}K`
}

function skillSourceLabel(
  source: OusiaInstalledSkill["source"],
  t: ReturnType<typeof getMessages>
) {
  switch (source) {
    case "global":
      return t.extensions.globalSkillSource
    case "pi":
      return t.extensions.piSkillSource
    case "pi-package":
      return t.extensions.piPackageSkillSource
  }
}

function packageActionLabel(
  packageName: string,
  isInstalled: boolean,
  pending: PendingPackageOperation | null,
  t: ReturnType<typeof getMessages>
) {
  if (!pending || pending.packageName !== packageName) {
    return isInstalled ? t.extensions.remove : t.extensions.install
  }
  if (pending.phase === "reloading") {
    return t.extensions.reloading
  }
  return pending.operation === "remove"
    ? t.extensions.removing
    : t.extensions.installing
}

export function ExtensionsPage({ language }: { language: OusiaLanguage }) {
  const t = getMessages(language)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [activeView, setActiveView] = useState<ExtensionsView>("explore")
  const [activeType, setActiveType] = useState<PiPackageFilter>("all")
  const [installedPackageNames, setInstalledPackageNames] = useState<
    Set<string>
  >(new Set())
  const [installedSkills, setInstalledSkills] = useState<
    OusiaInstalledSkill[]
  >([])
  const [missingPackageNames, setMissingPackageNames] = useState<string[]>([])
  const [statusPhase, setStatusPhase] = useState<"error" | "loading" | "ready">(
    "loading"
  )
  const [statusError, setStatusError] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [pendingPackageOperation, setPendingPackageOperation] =
    useState<PendingPackageOperation | null>(null)
  const locale = language === "zh" ? "zh-CN" : "en"
  const downloadFormatter = useMemo(
    () => new Intl.NumberFormat(locale),
    [locale]
  )
  const installedPackages = useMemo<PiPackageDisplayItem[]>(() => {
    const catalogByName = new Map(
      PI_PACKAGES.map((item) => [item.name, item] as const)
    )
    const packages = [...installedPackageNames].map((name) => {
      const catalogItem = catalogByName.get(name)
      if (catalogItem) {
        return catalogItem
      }
      return {
        rank: Number.MAX_SAFE_INTEGER,
        name,
        version: "",
        description: t.extensions.outsideCatalogDescription,
        author: "",
        monthlyDownloads: null,
        types: [],
        publishedAt: "",
        detailUrl: null,
        npmUrl: `https://www.npmjs.com/package/${name}`,
        repositoryUrl: null,
        installCommand: `pi install npm:${name}`,
      }
    })
    const skills: PiPackageDisplayItem[] = installedSkills.map((skill) => ({
      rank: Number.MAX_SAFE_INTEGER,
      name: skill.name,
      version: "",
      description: skill.description,
      author: skillSourceLabel(skill.source, t),
      monthlyDownloads: null,
      types: ["skill"],
      publishedAt: "",
      detailUrl: null,
      npmUrl: "",
      repositoryUrl: null,
      installCommand: "",
      installedSkill: skill,
    }))
    return [...packages, ...skills]
  }, [installedPackageNames, installedSkills, t])
  const filteredPackages = useMemo<PiPackageDisplayItem[]>(() => {
    if (activeView === "installed") {
      return installedPackages
    }
    return activeType === "all"
      ? PI_PACKAGES
      : PI_PACKAGES.filter((item) => item.types.includes(activeType))
  }, [activeType, activeView, installedPackages])
  const pageCount = Math.max(
    1,
    Math.ceil(filteredPackages.length / EXTENSIONS_PER_PAGE)
  )
  const visiblePage = Math.min(currentPage, pageCount)
  const visiblePackages = filteredPackages.slice(
    (visiblePage - 1) * EXTENSIONS_PER_PAGE,
    visiblePage * EXTENSIONS_PER_PAGE
  )
  async function refreshPackageStatus() {
    const messages = getMessages(language)
    setStatusPhase("loading")
    setStatusError(null)
    if (!window.ousia) {
      setStatusPhase("error")
      setStatusError(messages.extensions.packagesUnavailable)
      return
    }
    try {
      const [status, skillsResult] = await Promise.all([
        window.ousia.listPiPackages(),
        window.ousia.listInstalledSkills(),
      ])
      setInstalledPackageNames(new Set(status.installedPackageNames))
      setInstalledSkills(skillsResult.skills)
      setMissingPackageNames(status.missingPackageNames)
      setStatusPhase("ready")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusPhase("error")
      setStatusError(messages.extensions.statusLoadFailed(message))
    }
  }

  useEffect(() => {
    let cancelled = false
    const api = window.ousia
    if (!api) {
      void Promise.resolve().then(() => {
        if (cancelled) return
        setStatusPhase("error")
        setStatusError(getMessages(language).extensions.packagesUnavailable)
      })
      return () => {
        cancelled = true
      }
    }
    void Promise.all([api.listPiPackages(), api.listInstalledSkills()]).then(
      ([status, skillsResult]) => {
        if (cancelled) return
        setInstalledPackageNames(new Set(status.installedPackageNames))
        setInstalledSkills(skillsResult.skills)
        setMissingPackageNames(status.missingPackageNames)
        setStatusPhase("ready")
      },
      (error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setStatusPhase("error")
        setStatusError(
          getMessages(language).extensions.statusLoadFailed(message)
        )
      }
    )
    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    const api = window.ousia
    if (!api) return
    return api.onPiPackageOperationProgress((progress) => {
      setPendingPackageOperation((current) => {
        if (
          !current ||
          current.packageName !== progress.packageName ||
          current.operation !== progress.operation
        ) {
          return current
        }
        return { ...current, phase: progress.phase }
      })
    })
  }, [])

  function selectPage(page: number) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new RangeError(`Invalid extensions page: ${page}`)
    }
    setCurrentPage(page)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }

  function selectType(value: unknown) {
    if (!isPiPackageFilter(value)) {
      throw new Error(`Unsupported Pi package type filter: ${String(value)}`)
    }
    setActiveType(value)
    setCurrentPage(1)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }

  function selectView(value: unknown) {
    if (!isExtensionsView(value)) {
      throw new Error(`Unsupported extensions view: ${String(value)}`)
    }
    setActiveView(value)
    setCurrentPage(1)
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function togglePackage(item: PiPackageDisplayItem) {
    if (!window.ousia || statusPhase !== "ready" || pendingPackageOperation) {
      throw new Error(`Pi package action is unavailable: ${item.name}`)
    }
    const isInstalled = installedPackageNames.has(item.name)
    const operation = isInstalled ? "remove" : "install"
    setPendingPackageOperation({
      operation,
      packageName: item.name,
      phase: isInstalled ? "removing" : "installing",
    })
    setOperationError(null)
    try {
      const status = isInstalled
        ? await window.ousia.removePiPackage({ packageName: item.name })
        : await window.ousia.installPiPackage({ packageName: item.name })
      setInstalledPackageNames(new Set(status.installedPackageNames))
      setMissingPackageNames(status.missingPackageNames)
      void window.ousia.listInstalledSkills().then(
        (result) => setInstalledSkills(result.skills),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setStatusError(t.extensions.statusLoadFailed(message))
        }
      )
      if (status.activation.status === "agent-running") {
        setOperationError(t.extensions.activationDeferred)
      } else if (status.activation.status === "failed") {
        setOperationError(
          t.extensions.activationFailed(status.activation.error)
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOperationError(
        isInstalled
          ? t.extensions.removeFailed(item.name, message)
          : t.extensions.installFailed(item.name, message)
      )
    } finally {
      setPendingPackageOperation(null)
    }
  }

  return (
    <section
      aria-label={t.extensions.title}
      className={cn(
        "ousia-main-panel @container/extensions relative z-20 flex min-w-0 flex-1 flex-col overflow-hidden bg-white shadow-[var(--ousia-main-panel-shadow)] dark:bg-[var(--ousia-chat-panel-surface)]",
        MAIN_PANEL_LEFT_CORNERS_CLASS
      )}
    >
      <div aria-hidden="true" className="window-drag h-10 shrink-0" />
      <div
        ref={scrollContainerRef}
        className="ousia-hover-scrollbar ousia-stable-scrollbar-gutter min-h-0 flex-1 overflow-auto px-4 pt-4 @min-[760px]/extensions:px-8"
      >
        <div className={cn(CHAT_CONTENT_MAX_WIDTH_CLASS, "grid gap-4 pb-10")}>
          <header className="px-1 pb-1">
            <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight text-foreground">
              {t.extensions.title}
            </h1>
          </header>

          <Tabs value={activeView} onValueChange={selectView} className="gap-4">
            <div className="flex items-center justify-between gap-4 px-1">
              <TabsList aria-label={t.extensions.viewLabel}>
                <TabsTrigger value="explore">
                  {t.extensions.explore}
                </TabsTrigger>
                <TabsTrigger value="installed">
                  {t.extensions.installed}
                </TabsTrigger>
              </TabsList>
              {activeView === "explore" ? (
                <Select
                  items={[
                    { label: t.extensions.allTypes, value: "all" },
                    {
                      label: t.extensions.extensionType,
                      value: "extension",
                    },
                    { label: t.extensions.packageType, value: "package" },
                    { label: t.extensions.skillType, value: "skill" },
                    { label: t.extensions.promptType, value: "prompt" },
                    { label: t.extensions.themeType, value: "theme" },
                  ]}
                  value={activeType}
                  onValueChange={selectType}
                >
                  <SelectTrigger
                    aria-label={t.extensions.filterLabel}
                    className="window-no-drag min-w-36"
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      <SelectItem value="all">
                        {t.extensions.allTypes}
                      </SelectItem>
                      <SelectItem value="extension">
                        {t.extensions.extensionType}
                      </SelectItem>
                      <SelectItem value="package">
                        {t.extensions.packageType}
                      </SelectItem>
                      <SelectItem value="skill">
                        {t.extensions.skillType}
                      </SelectItem>
                      <SelectItem value="prompt">
                        {t.extensions.promptType}
                      </SelectItem>
                      <SelectItem value="theme">
                        {t.extensions.themeType}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            {statusError ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                <span>{statusError}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-destructive"
                  onClick={() => void refreshPackageStatus()}
                >
                  {t.extensions.retry}
                </Button>
              </div>
            ) : null}
            {operationError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                {operationError}
              </div>
            ) : null}
            {missingPackageNames.length ? (
              <div
                role="status"
                className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
              >
                {t.extensions.missingPackages(missingPackageNames.join(", "))}
              </div>
            ) : null}

            <TabsContent value={activeView} className="grid gap-4">
              {statusPhase === "loading" && activeView === "installed" ? (
                <div className="rounded-lg border border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  {t.extensions.loadingInstalled}
                </div>
              ) : null}
              {statusPhase === "ready" &&
              activeView === "installed" &&
              filteredPackages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {t.extensions.noInstalled}
                </div>
              ) : null}

              <div className="grid gap-2.5">
                {visiblePackages.map((item) => (
                  <Card
                    key={item.installedSkill?.id ?? item.name}
                    size="sm"
                    className="gap-0 rounded-lg border border-border/70 bg-card py-0 shadow-none ring-0"
                  >
                    <CardContent className="min-w-0 px-4 py-3">
                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {item.repositoryUrl ? (
                            <a
                              href={item.repositoryUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={t.extensions.openRepository(
                                item.name
                              )}
                              className="min-w-0 truncate text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            >
                              {item.name}
                            </a>
                          ) : (
                            <span
                              className="min-w-0 truncate text-sm font-medium text-foreground"
                              title={
                                item.installedSkill
                                  ? undefined
                                  : t.extensions.repositoryUnavailable
                              }
                            >
                              {item.name}
                            </span>
                          )}
                          {item.detailUrl ? (
                            <Button
                              asChild
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground"
                            >
                              <a
                                href={item.detailUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={t.extensions.openDetails(item.name)}
                              >
                                <Link aria-hidden="true" />
                              </a>
                            </Button>
                          ) : null}
                        </div>
                        {item.monthlyDownloads !== null ? (
                          <span
                            className="shrink-0 text-xs font-medium text-foreground tabular-nums"
                            title={t.extensions.downloadsPerMonth(
                              downloadFormatter.format(item.monthlyDownloads)
                            )}
                          >
                            {formatCompactDownloads(item.monthlyDownloads)}
                          </span>
                        ) : null}
                      </div>

                      <p
                        className="mt-1.5 truncate text-xs text-muted-foreground"
                        title={item.description}
                      >
                        {item.description}
                      </p>

                      <div className="mt-2 flex min-w-0 items-end justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          {item.author ? (
                            <span className="min-w-0 truncate">
                              {item.author}
                            </span>
                          ) : null}
                          <div className="flex shrink-0 items-center gap-1">
                            {item.types.map((type) => (
                              <span
                                key={type}
                                className="rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground"
                              >
                                {packageTypeLabel(type, t)}
                              </span>
                            ))}
                            {item.installedSkill &&
                            !item.installedSkill.enabled ? (
                              <span className="rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                                {t.extensions.disabledSkill}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {item.installedSkill ? null : (
                          <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            className="min-w-14 shrink-0"
                            disabled={
                              statusPhase !== "ready" ||
                              pendingPackageOperation !== null
                            }
                            onClick={() => void togglePackage(item)}
                          >
                            {packageActionLabel(
                              item.name,
                              installedPackageNames.has(item.name),
                              pendingPackageOperation,
                              t
                            )}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {filteredPackages.length > EXTENSIONS_PER_PAGE ? (
                <nav
                  aria-label={t.extensions.pagination}
                  className="flex items-center justify-center gap-1 pt-3"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={visiblePage === 1}
                    aria-label={t.extensions.previousPage}
                    onClick={() => selectPage(visiblePage - 1)}
                  >
                    <ArrowLeft aria-hidden="true" />
                  </Button>
                  {Array.from(
                    { length: pageCount },
                    (_, index) => index + 1
                  ).map((page) => (
                    <Button
                      key={page}
                      type="button"
                      variant={page === visiblePage ? "outline" : "ghost"}
                      size="icon-sm"
                      aria-current={page === visiblePage ? "page" : undefined}
                      aria-label={t.extensions.page(page, pageCount)}
                      onClick={() => selectPage(page)}
                    >
                      {page}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={visiblePage === pageCount}
                    aria-label={t.extensions.nextPage}
                    onClick={() => selectPage(visiblePage + 1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </nav>
              ) : null}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </section>
  )
}
