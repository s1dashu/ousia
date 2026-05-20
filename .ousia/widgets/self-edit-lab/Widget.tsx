import type { WidgetProps } from "../../../src/widgets/types"

const checks = [
  "Project-local widget directory scanned",
  "TSX compiled by Electron main",
  "Workspace tab registered at runtime",
]

export default function SelfEditLab({ context }: WidgetProps) {
  return (
    <div className="space-y-3">
      <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
        <div className="text-xs font-medium text-muted-foreground uppercase">
          Runtime widget
        </div>
        <h3 className="mt-2 text-xl font-semibold">Self Edit Lab</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          This tab was loaded from the selected project instead of the compiled
          app registry.
        </p>
      </section>

      <section className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
        <div className="text-sm font-medium">Current context</div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
          <div className="rounded-lg bg-muted p-3">{context.project.path}</div>
          <div className="rounded-lg bg-muted p-3">
            {context.conversation.title}
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
        <div className="text-sm font-medium">Runtime checks</div>
        <div className="mt-3 grid gap-2">
          {checks.map((check) => (
            <div
              key={check}
              className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"
            >
              {check}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
