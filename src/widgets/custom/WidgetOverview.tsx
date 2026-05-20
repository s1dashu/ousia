import {
  CodeSquareBoldDuotone,
  LayersMinimalisticBoldDuotone,
  Widget6BoldDuotone,
} from "solar-icon-set"

import type { WidgetProps } from "@/widgets/types"

const metrics = [
  { label: "Slots", value: "3", icon: LayersMinimalisticBoldDuotone },
  { label: "Workspace widgets", value: "4", icon: Widget6BoldDuotone },
  { label: "Custom widgets", value: "1", icon: CodeSquareBoldDuotone },
]

export function WidgetOverview({ context }: WidgetProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-violet-500/15 text-violet-300 ring-1 ring-violet-300/15">
            <Widget6BoldDuotone size={30} />
          </div>
          <div className="text-xs font-medium text-muted-foreground">
            Runtime ready
          </div>
        </div>
        <h3 className="mt-2 text-xl font-semibold">{context.project.name}</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Workspace is the first customizable widget surface. Sidebar and chat
          slots are already represented in the registry model for later
          replacement.
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-muted-foreground">
                {metric.label}
              </div>
              <div className="grid size-9 place-items-center rounded-xl bg-blue-500/15 text-blue-300 ring-1 ring-blue-300/15">
                <metric.icon size={23} />
              </div>
            </div>
            <div className="mt-3 text-2xl font-semibold tabular-nums">
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      <section className="rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
        <div className="grid gap-2">
          <div className="rounded-lg bg-muted p-3">
            <div className="text-sm font-medium">System widgets</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Sidebar, chat, workspace shell
            </div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-sm font-medium">Custom widgets</div>
            <div className="mt-1 text-xs text-muted-foreground">
              React components registered into workspace tabs
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
