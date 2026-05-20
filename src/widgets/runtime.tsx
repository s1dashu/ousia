/* eslint-disable react-refresh/only-export-components */
import React from "react"

import type {
  OusiaRuntimeWidget,
  OusiaRuntimeWidgetError,
} from "@/electron/chat-types"
import type { WidgetDefinition, WidgetProps } from "@/widgets/types"

function requireRuntimeDependency(name: string) {
  if (name === "react") {
    return React
  }
  throw new Error(`Runtime widget dependency is not available: ${name}`)
}

function createRuntimeComponent(widget: OusiaRuntimeWidget) {
  const module = { exports: {} as Record<string, unknown> }
  const exports = module.exports
  const evaluate = new Function(
    "React",
    "exports",
    "module",
    "require",
    `${widget.code}
return module.exports.default ?? module.exports.Widget ?? module.exports;`
  )
  const component = evaluate(
    React,
    exports,
    module,
    requireRuntimeDependency
  ) as unknown

  if (typeof component !== "function") {
    throw new Error(`Runtime widget "${widget.title}" must export a component.`)
  }

  return component as React.ComponentType<WidgetProps>
}

function createRuntimeWidgetWrapper(widget: OusiaRuntimeWidget) {
  let Component: React.ComponentType<WidgetProps> | undefined
  return function RuntimeWidget(props: WidgetProps) {
    Component ??= createRuntimeComponent(widget)
    return <Component {...props} />
  }
}

function RuntimeWidgetErrorPanel({
  error,
}: {
  error: OusiaRuntimeWidgetError
}) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-card p-4 text-sm text-card-foreground shadow-sm">
      <div className="font-medium">{error.title} failed to load</div>
      <div className="mt-1 text-muted-foreground">{error.message}</div>
      {error.sourcePath ? (
        <div className="mt-3 rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all text-muted-foreground">
          {error.sourcePath}
        </div>
      ) : null}
    </div>
  )
}

export function runtimeWidgetsToDefinitions(
  widgets: OusiaRuntimeWidget[],
  errors: OusiaRuntimeWidgetError[]
): WidgetDefinition[] {
  return [
    ...widgets.map((widget) => ({
      id: widget.id,
      title: widget.title,
      slot: widget.slot,
      kind: "custom" as const,
      component: createRuntimeWidgetWrapper(widget),
    })),
    ...errors.map((error) => ({
      id: error.id,
      title: error.title,
      slot: "workspace.tab" as const,
      kind: "custom" as const,
      component: () => <RuntimeWidgetErrorPanel error={error} />,
    })),
  ]
}
