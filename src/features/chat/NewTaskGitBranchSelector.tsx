import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"

import { getMessages } from "@/app/i18n"
import {
  Check,
  GitBranch,
  Plus,
  Search,
} from "@/components/icons/nucleo-icons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import type {
  OusiaGitBranchState,
  OusiaLanguage,
} from "@/electron/chat-types"
import { cn } from "@/lib/utils"

type LoadedBranchState = {
  projectId: string
  state: OusiaGitBranchState
}

export function NewTaskGitBranchSelector({
  disabled = false,
  language,
  projectId,
}: {
  disabled?: boolean
  language: OusiaLanguage
  projectId: string
}) {
  const t = getMessages(language)
  const [loaded, setLoaded] = useState<LoadedBranchState>()
  const [loadError, setLoadError] = useState(() =>
    window.ousia ? "" : t.git.unavailable
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [isMutating, setIsMutating] = useState(false)
  const [mutationError, setMutationError] = useState("")
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState("codex/")
  const [hasBranchNameBlurred, setHasBranchNameBlurred] = useState(false)
  const [createError, setCreateError] = useState("")
  const branchListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ousia = window.ousia
    if (!ousia) {
      return
    }
    let canceled = false
    void ousia
      .getGitBranches({ projectId })
      .then((result) => {
        if (canceled) return
        if (!result.ok || !result.state) {
          setLoadError(result.error ?? t.git.readFailed)
          return
        }
        setLoaded({ projectId, state: result.state })
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      canceled = true
    }
  }, [projectId, t.git.readFailed, t.git.unavailable])

  const branchState = loaded?.projectId === projectId ? loaded.state : undefined
  const visibleBranches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return (branchState?.branches ?? []).filter((branch) =>
      branch.name.toLocaleLowerCase().includes(normalizedQuery)
    )
  }, [branchState?.branches, query])
  const effectiveActiveIndex = visibleBranches.length
    ? Math.min(activeIndex, visibleBranches.length - 1)
    : -1

  useEffect(() => {
    if (!open || effectiveActiveIndex < 0) return
    branchListRef.current
      ?.querySelector<HTMLElement>(
        `[data-branch-index="${effectiveActiveIndex}"]`
      )
      ?.scrollIntoView({ block: "nearest" })
  }, [effectiveActiveIndex, open])

  if (!branchState && !loadError) {
    return null
  }
  if (branchState && !branchState.isRepository) {
    return null
  }

  const currentBranch = branchState?.currentBranch
  const triggerLabel = loadError
    ? t.git.statusFailed
    : (currentBranch ?? t.git.detachedHead)

  async function switchBranch(branchName: string) {
    const ousia = window.ousia
    if (!ousia || branchName === currentBranch || isMutating) return
    setIsMutating(true)
    setMutationError("")
    try {
      const result = await ousia.switchGitBranch({ branchName, projectId })
      if (!result.ok || !result.state) {
        setMutationError(result.error ?? t.git.switchFailed)
        return
      }
      setLoaded({ projectId, state: result.state })
      setOpen(false)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsMutating(false)
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.stopPropagation()
    if (!visibleBranches.length) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((effectiveActiveIndex + 1) % visibleBranches.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex(
        (effectiveActiveIndex - 1 + visibleBranches.length) %
          visibleBranches.length
      )
      return
    }
    if (event.key === "Enter" && effectiveActiveIndex >= 0) {
      event.preventDefault()
      void switchBranch(visibleBranches[effectiveActiveIndex].name)
    }
  }

  function openCreateDialog() {
    setOpen(false)
    setNewBranchName("codex/")
    setHasBranchNameBlurred(false)
    setCreateError("")
    setIsCreateDialogOpen(true)
  }

  async function createBranch() {
    const ousia = window.ousia
    const branchName = newBranchName.trim()
    if (!ousia || !branchName || branchName.endsWith("/") || isMutating) return
    setIsMutating(true)
    setCreateError("")
    try {
      const result = await ousia.createGitBranch({ branchName, projectId })
      if (!result.ok || !result.state) {
        setCreateError(result.error ?? t.git.createFailed)
        return
      }
      setLoaded({ projectId, state: result.state })
      setIsCreateDialogOpen(false)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsMutating(false)
    }
  }

  const invalidNewBranchName =
    !newBranchName.trim() || newBranchName.trim().endsWith("/")

  return (
    <>
      <DropdownMenuSub
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          setMutationError("")
          if (nextOpen) {
            setActiveIndex(
              Math.max(
                0,
                visibleBranches.findIndex(
                  (branch) => branch.name === currentBranch
                )
              )
            )
          } else {
            setQuery("")
          }
        }}
      >
        <DropdownMenuSubTrigger
          className={cn(loadError && "text-destructive")}
          disabled={disabled}
          aria-label={`${t.git.branchSelector}: ${triggerLabel}`}
        >
          <GitBranch className="text-muted-foreground" />
          <span className="flex-1">{t.git.switchBranch}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          className="w-[min(288px,calc(100vw-3rem))]"
        >
          <div className="flex h-9 items-center gap-2 px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={t.git.searchBranches}
              className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            />
          </div>
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t.git.branches}</DropdownMenuLabel>
            <div
              ref={branchListRef}
              className="ousia-hover-scrollbar max-h-64 overflow-y-auto"
            >
              {visibleBranches.map((branch, index) => (
                <DropdownMenuItem
                  key={branch.name}
                  data-branch-index={index}
                  disabled={isMutating}
                  className={cn(
                    "items-start py-1.5",
                    index === effectiveActiveIndex && "bg-accent"
                  )}
                  onClick={() => void switchBranch(branch.name)}
                  onPointerMove={() => setActiveIndex(index)}
                >
                  <GitBranch className="mt-0.5 size-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{branch.name}</span>
                    {branch.name === currentBranch &&
                    branchState?.dirtyFileCount ? (
                      <span className="block text-xs text-muted-foreground">
                        {t.git.dirtyFiles(branchState.dirtyFileCount)}
                      </span>
                    ) : null}
                  </span>
                  {branch.name === currentBranch ? (
                    <Check className="mt-0.5 size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuGroup>
          {loadError || mutationError ? (
            <div className="px-2 py-1.5 text-xs text-destructive">
              {loadError || mutationError}
            </div>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={Boolean(loadError)} onClick={openCreateDialog}>
            <Plus className="size-4" />
            {t.git.createAndCheckout}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.git.createAndCheckoutTitle}</DialogTitle>
            <DialogDescription>{t.git.createAndCheckoutHelp}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="new-git-branch" className="text-sm font-medium">
              {t.git.branchName}
            </label>
            <Input
              id="new-git-branch"
              autoFocus
              value={newBranchName}
              onChange={(event) => {
                setNewBranchName(event.target.value)
                setCreateError("")
              }}
              onBlur={() => setHasBranchNameBlurred(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !invalidNewBranchName) {
                  event.preventDefault()
                  void createBranch()
                }
              }}
            />
            {(hasBranchNameBlurred && invalidNewBranchName) || createError ? (
              <p className="text-sm text-destructive">
                {createError || t.git.invalidBranchName}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              {t.app.close}
            </Button>
            <Button
              type="button"
              disabled={invalidNewBranchName || isMutating}
              onClick={() => void createBranch()}
            >
              {t.git.createAndCheckoutAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
