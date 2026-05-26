import { Component, type ReactNode } from "react"

import type { ExtensionContext, ExtensionDefinition } from "@/extensions/types"

type ExtensionSlotProps = {
  extension: ExtensionDefinition
  context: ExtensionContext
}

export function ExtensionSlot({ extension, context }: ExtensionSlotProps) {
  const Component = extension.component

  return (
    <ExtensionErrorBoundary title={extension.title}>
      <Component context={context} />
    </ExtensionErrorBoundary>
  )
}

class ExtensionErrorBoundary extends Component<
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
          <div className="font-medium">{this.props.title} 运行失败</div>
          <div className="mt-1 text-muted-foreground">
            {this.state.error.message}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
