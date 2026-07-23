import { useEffect, useState } from "react"

import { getMessages } from "@/app/i18n"
import { LoaderCircle } from "@/components/icons/huge-icons"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type {
  OusiaLanguage,
  OusiaPiEnvironmentStatus,
  OusiaPiRuntimeActionResult,
} from "@/electron/chat-types"

type RuntimeOperation = "install" | "select" | null

type PiRuntimeSetupDialogProps = {
  environment: OusiaPiEnvironmentStatus | undefined
  language: OusiaLanguage
  onEnvironmentChange: (environment: OusiaPiEnvironmentStatus) => void
  onOpenChange: (open: boolean) => void
  onRefreshModelRegistry: () => Promise<unknown>
  open: boolean
}

export function PiRuntimeSetupDialog({
  environment,
  language,
  onEnvironmentChange,
  onOpenChange,
  onRefreshModelRegistry,
  open,
}: PiRuntimeSetupDialogProps) {
  const t = getMessages(language)
  const [operation, setOperation] = useState<RuntimeOperation>(null)
  const [runtimeError, setRuntimeError] = useState("")

  useEffect(() => {
    if (!open || environment) return
    let canceled = false
    void window.ousia
      .checkPiEnvironment()
      .then((status) => {
        if (!canceled) onEnvironmentChange(status)
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setRuntimeError(
            error instanceof Error ? error.message : String(error),
          )
        }
      })
    return () => {
      canceled = true
    }
  }, [environment, onEnvironmentChange, open])

  async function runRuntimeAction(
    nextOperation: Exclude<RuntimeOperation, null>,
    action: () => Promise<OusiaPiRuntimeActionResult>,
  ) {
    setRuntimeError("")
    setOperation(nextOperation)
    try {
      const result = await action()
      if (result.canceled) return
      if (!result.ok) {
        throw new Error(result.error ?? t.settings.piRuntimeActionFailed)
      }
      if (!result.status) {
        throw new Error(
          "Pi Runtime operation did not return its environment status.",
        )
      }
      onEnvironmentChange(result.status)
      if (!result.status.available) {
        throw new Error(
          result.status.error ??
            "Pi Runtime remained unavailable after the operation completed.",
        )
      }
      await onRefreshModelRegistry()
      onOpenChange(false)
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error))
    } finally {
      setOperation(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && operation) return
        setRuntimeError("")
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.chat.piRuntimeRequiredTitle}</DialogTitle>
          <DialogDescription>
            {t.chat.piRuntimeRequiredDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="border-border/70 bg-muted/25 rounded-lg border px-4 py-3.5">
            <div className="text-foreground flex items-center gap-2 text-sm font-medium">
              {!environment ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="text-muted-foreground animate-spin"
                  size={16}
                />
              ) : null}
              {environment?.available
                ? t.settings.piRuntimeReady
                : environment
                  ? t.settings.piRuntimeMissing
                  : t.settings.piRuntimeLoading}
            </div>
            <p className="text-muted-foreground mt-1 text-sm leading-5">
              {environment?.available
                ? `${environment.version ?? "Pi"} · ${environment.binaryPath}`
                : t.settings.installPiConfirmation}
            </p>
          </div>

          {environment?.installPrerequisiteError ? (
            <div
              role="alert"
              className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm leading-5 text-amber-800 dark:text-amber-300"
            >
              {environment.installPrerequisiteError}
            </div>
          ) : null}
          {runtimeError ? (
            <div
              role="alert"
              className="bg-destructive/10 text-destructive rounded-lg px-4 py-3 text-sm leading-5"
            >
              {runtimeError}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={Boolean(operation)}
            onClick={() => onOpenChange(false)}
          >
            {t.app.cancel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!environment || Boolean(operation)}
            onClick={() =>
              void runRuntimeAction("select", () =>
                window.ousia.selectPiBinary(),
              )
            }
          >
            {operation === "select" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : null}
            {t.settings.selectExistingPi}
          </Button>
          {environment?.canInstall ? (
            <Button
              type="button"
              size="sm"
              disabled={Boolean(operation)}
              onClick={() =>
                void runRuntimeAction("install", () =>
                  window.ousia.installPiRuntime(),
                )
              }
            >
              {operation === "install" ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : null}
              {t.settings.installPi}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
