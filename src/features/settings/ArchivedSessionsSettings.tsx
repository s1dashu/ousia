import { useMemo, useState } from "react"

import { getMessages } from "@/app/i18n"
import type { ProjectRecord, SessionRecord } from "@/app/app-state"
import { ArchiveRestore, Trash2 } from "@/components/icons/huge-icons"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/features/settings/SettingsButton"
import { Card } from "@/features/settings/SettingsCard"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/features/settings/SettingsDialog"
import type { OusiaLanguage } from "@/electron/chat-types"

type ArchivedSessionsSettingsProps = {
  language: OusiaLanguage
  onDelete: (sessionIds: string[]) => Promise<void>
  onRestore: (sessionIds: string[]) => Promise<void>
  projects: ProjectRecord[]
  sessions: SessionRecord[]
}

function SelectionCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      className="size-4 rounded border-border accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

export function ArchivedSessionsSettings({
  language,
  onDelete,
  onRestore,
  projects,
  sessions,
}: ArchivedSessionsSettingsProps) {
  const t = getMessages(language)
  const archivedSessions = useMemo(
    () =>
      sessions
        .filter((session) => session.archivedAt)
        .sort((left, right) =>
          right.archivedAt!.localeCompare(left.archivedAt!)
        ),
    [sessions]
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [deleteIds, setDeleteIds] = useState<string[]>([])
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState("")

  const archivedIds = new Set(archivedSessions.map((session) => session.id))
  const effectiveSelectedIds = new Set(
    [...selectedIds].filter((sessionId) => archivedIds.has(sessionId))
  )

  const projectNames = new Map(
    projects.map((project) => [project.id, project.name])
  )
  const allSelected =
    archivedSessions.length > 0 &&
    effectiveSelectedIds.size === archivedSessions.length

  function toggleSession(sessionId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }

  async function apply(action: "restore" | "delete", sessionIds: string[]) {
    setIsApplying(true)
    setError("")
    try {
      if (action === "restore") await onRestore(sessionIds)
      else await onDelete(sessionIds)
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const sessionId of sessionIds) next.delete(sessionId)
        return next
      })
      setDeleteIds([])
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : String(actionError)
      )
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <section className="grid gap-2.5">
      <div className="grid gap-1 px-1">
        <p className="text-sm leading-5 text-muted-foreground">
          {t.settings.archivedSessionsDescription}
        </p>
      </div>
      <Card size="sm" className="gap-0 overflow-hidden py-0">
        {archivedSessions.length ? (
          <>
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <SelectionCheckbox
                  checked={allSelected}
                  label={t.settings.selectAll}
                  onChange={(checked) =>
                    setSelectedIds(
                      checked
                        ? new Set(archivedSessions.map((session) => session.id))
                        : new Set()
                    )
                  }
                />
                <span>
                  {effectiveSelectedIds.size
                    ? t.settings.selectedCount(effectiveSelectedIds.size)
                    : t.settings.selectAll}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!effectiveSelectedIds.size || isApplying}
                  onClick={() =>
                    void apply("restore", [...effectiveSelectedIds])
                  }
                >
                  <ArchiveRestore />
                  {t.settings.restoreSelected}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!effectiveSelectedIds.size || isApplying}
                  onClick={() => setDeleteIds([...effectiveSelectedIds])}
                >
                  <Trash2 />
                  {t.settings.deleteSelectedPermanently}
                </Button>
              </div>
            </div>
            {error ? (
              <div
                role="alert"
                className="border-b px-4 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4" />
                  <TableHead>{t.settings.sessionTitle}</TableHead>
                  <TableHead>{t.settings.sessionLocation}</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>{t.settings.archivedAt}</TableHead>
                  <TableHead className="w-24 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {archivedSessions.map((session) => (
                  <TableRow
                    key={session.id}
                    data-state={
                      effectiveSelectedIds.has(session.id)
                        ? "selected"
                        : undefined
                    }
                  >
                    <TableCell className="pl-4">
                      <SelectionCheckbox
                        checked={effectiveSelectedIds.has(session.id)}
                        label={session.title}
                        onChange={(checked) =>
                          toggleSession(session.id, checked)
                        }
                      />
                    </TableCell>
                    <TableCell className="max-w-64 truncate font-medium">
                      {session.title}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-muted-foreground">
                      {session.projectId
                        ? (projectNames.get(session.projectId) ??
                          session.projectId)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground uppercase">
                      {session.agentProvider}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Intl.DateTimeFormat(
                        language === "zh" ? "zh-CN" : "en",
                        {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }
                      ).format(new Date(session.archivedAt!))}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={isApplying}
                          title={t.settings.restore}
                          onClick={() => void apply("restore", [session.id])}
                        >
                          <ArchiveRestore />
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          disabled={isApplying}
                          title={t.settings.permanentDelete}
                          onClick={() => setDeleteIds([session.id])}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t.settings.noArchivedSessions}
          </div>
        )}
      </Card>

      <Dialog
        open={deleteIds.length > 0}
        onOpenChange={(open) => !open && setDeleteIds([])}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.settings.confirmPermanentDeleteTitle}</DialogTitle>
            <DialogDescription>
              {t.settings.confirmPermanentDeleteDescription(deleteIds.length)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteIds([])}
            >
              {t.app.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isApplying}
              onClick={() => void apply("delete", deleteIds)}
            >
              {t.settings.permanentDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
