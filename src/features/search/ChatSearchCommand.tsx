import { useEffect, useRef, useState } from "react"

import type {
  OusiaChatSearchResultItem,
  OusiaLanguage,
} from "@/electron/chat-types"
import { getMessages } from "@/app/i18n"
import {
  ArchiveAction,
  BubbleChat,
  FolderOpen,
  LoaderCircle,
  PanelLeft,
  Plus,
  Search,
  Settings,
} from "@/components/icons/nucleo-icons"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"

type ChatSearchCommandProps = {
  currentSessionId?: string
  currentSessionTitle?: string
  language: OusiaLanguage
  onArchiveCurrentSession: () => void
  onCreateSession: () => void
  onFocusComposer: () => void
  onOpenChange: (open: boolean) => void
  onOpenProject: () => void
  onOpenSettings: () => void
  onSearchCurrentSession: () => void
  onSelectMessage: (itemId: string) => void
  onSelectSession: (sessionId: string) => void
  onToggleSidebar: () => void
  open: boolean
  sidebarToggleLabel: string
  scope: "all" | "current"
}

export function ChatSearchCommand({
  currentSessionId,
  currentSessionTitle,
  language,
  onArchiveCurrentSession,
  onCreateSession,
  onFocusComposer,
  onOpenChange,
  onOpenProject,
  onOpenSettings,
  onSearchCurrentSession,
  onSelectMessage,
  onSelectSession,
  onToggleSidebar,
  open,
  sidebarToggleLabel,
  scope,
}: ChatSearchCommandProps) {
  const t = getMessages(language)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<OusiaChatSearchResultItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return

    const generation = requestGenerationRef.current
    const timer = window.setTimeout(() => {
      if (!window.ousia) {
        setError(t.search.unavailable)
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setError("")
      window.ousia
        .searchChats({
          query: trimmedQuery,
          ...(scope === "current" && currentSessionId
            ? { sessionId: currentSessionId }
            : {}),
        })
        .then((result) => {
          if (requestGenerationRef.current !== generation) return
          setResults(result.items)
        })
        .catch((searchError: unknown) => {
          if (requestGenerationRef.current !== generation) return
          console.error("[chat.search] Search failed", searchError)
          setResults([])
          setError(t.search.failed)
        })
        .finally(() => {
          if (requestGenerationRef.current === generation) {
            setIsLoading(false)
          }
        })
    }, 180)

    return () => window.clearTimeout(timer)
  }, [currentSessionId, query, scope, t.search.failed, t.search.unavailable])

  function handleQueryChange(value: string) {
    requestGenerationRef.current += 1
    setQuery(value)
    setResults([])
    setError("")
    setIsLoading(Boolean(value.trim()))
  }

  function runAction(action: () => void) {
    onOpenChange(false)
    action()
  }

  function selectResult(sessionId: string) {
    onOpenChange(false)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    onSelectSession(sessionId)
  }

  function selectMessage(itemId: string) {
    onOpenChange(false)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    onSelectMessage(itemId)
  }

  const hasQuery = Boolean(query.trim())

  return (
    <CommandDialog
      description={
        scope === "current"
          ? t.search.currentDescription(currentSessionTitle ?? "")
          : t.search.description
      }
      onOpenChange={onOpenChange}
      open={open}
      title={scope === "current" ? t.search.currentTitle : t.search.title}
    >
      <CommandInput
        autoFocus
        maxLength={200}
        onValueChange={handleQueryChange}
        placeholder={
          scope === "current"
            ? t.search.currentPlaceholder
            : t.search.placeholder
        }
        value={query}
      />
      <CommandList>
        {!hasQuery ? (
          <>
            <CommandGroup heading={t.search.quickActions}>
              <CommandItem
                onSelect={() => onOpenChange(false)}
                value="toggle-search"
              >
                <Search className="size-4" />
                <span>{t.search.toggleSearch}</span>
                <CommandShortcut>⌘K</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => runAction(onCreateSession)}
                value="new-task"
              >
                <Plus className="size-4" />
                <span>{t.sidebar.utilityNewTask}</span>
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => runAction(onOpenSettings)}
                value="settings"
              >
                <Settings className="size-4" />
                <span>{t.sidebar.settings}</span>
                <CommandShortcut>⌘,</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => runAction(onToggleSidebar)}
                value="toggle-sidebar"
              >
                <PanelLeft className="size-4" />
                <span>{sidebarToggleLabel}</span>
                <CommandShortcut>⌘B</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => runAction(onOpenProject)}
                value="open-project"
              >
                <FolderOpen className="size-4" />
                <span>{t.search.openProject}</span>
                <CommandShortcut>⌘⇧O</CommandShortcut>
              </CommandItem>
              {currentSessionId ? (
                <>
                  <CommandItem
                    onSelect={() => runAction(onFocusComposer)}
                    value="focus-composer"
                  >
                    <BubbleChat className="size-4" />
                    <span>{t.search.focusComposer}</span>
                    <CommandShortcut>⌘L</CommandShortcut>
                  </CommandItem>
                  {scope === "all" ? (
                    <CommandItem
                      onSelect={onSearchCurrentSession}
                      value="search-current"
                    >
                      <Search className="size-4" />
                      <span>{t.search.searchCurrent}</span>
                      <CommandShortcut>⌘⇧F</CommandShortcut>
                    </CommandItem>
                  ) : null}
                  <CommandItem
                    onSelect={() => runAction(onArchiveCurrentSession)}
                    value="archive-current"
                  >
                    <ArchiveAction className="size-4" />
                    <span>{t.search.archiveCurrent}</span>
                    <CommandShortcut>⌘⇧A</CommandShortcut>
                  </CommandItem>
                </>
              ) : null}
            </CommandGroup>
            <CommandSeparator />
            <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
              <span>{t.search.keyboardHint}</span>
              <span className="flex gap-3">
                <span>⌘[/⌘] {t.search.recentConversations}</span>
                <span>↑↓ {t.search.navigate}</span>
                <span>↵ {t.search.open}</span>
                <span>esc {t.search.close}</span>
              </span>
            </div>
          </>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {t.search.searching}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="py-10 text-center text-sm text-destructive"
          >
            {error}
          </div>
        ) : (
          <>
            <CommandEmpty>
              {scope === "current"
                ? t.search.currentNoResults
                : t.search.noResults}
            </CommandEmpty>
            <CommandGroup
              heading={
                scope === "current"
                  ? t.search.currentMatches
                  : t.search.conversations
              }
            >
              {results.map((result) => (
                <CommandItem
                  key={result.itemId ?? result.sessionId}
                  className="items-start"
                  onSelect={() =>
                    result.itemId
                      ? selectMessage(result.itemId)
                      : selectResult(result.sessionId)
                  }
                  value={result.itemId ?? result.sessionId}
                >
                  <BubbleChat className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {result.role
                          ? result.role === "user"
                            ? t.search.you
                            : t.search.assistant
                          : result.title}
                      </span>
                      {result.projectName ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {result.projectName}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {result.snippet ?? t.search.titleMatch}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
