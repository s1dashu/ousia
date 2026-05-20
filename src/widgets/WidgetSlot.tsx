import { Component, type ReactNode } from "react"

import type { WidgetContext, WidgetDefinition } from "@/widgets/types"

type WidgetSlotProps = {
  widget: WidgetDefinition
  context: WidgetContext
}

export function WidgetSlot({ widget, context }: WidgetSlotProps) {
  const Component = widget.component

  return (
    <WidgetErrorBoundary title={widget.title}>
      <Component context={context} />
    </WidgetErrorBoundary>
  )
}

class WidgetErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border bg-card p-4 text-sm text-card-foreground">
          <div className="font-medium">{this.props.title} failed</div>
          <div className="mt-1 text-muted-foreground">
            {this.state.error.message}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
