/* eslint-disable react-refresh/only-export-components */
import React from "react"

import type {
  OusiaRuntimeExtension,
  OusiaRuntimeExtensionError,
} from "@/electron/chat-types"
import type { ExtensionDefinition, ExtensionProps } from "@/extensions/types"

function requireRuntimeDependency(name: string) {
  if (name === "react") {
    return React
  }
  throw new Error(`Runtime extension dependency is not available: ${name}`)
}

function createRuntimeComponent(extension: OusiaRuntimeExtension) {
  const module = { exports: {} as Record<string, unknown> }
  const exports = module.exports
  const evaluate = new Function(
    "React",
    "exports",
    "module",
    "require",
    `${extension.code}
return module.exports.default ?? module.exports.App ?? module.exports;`
  )
  const component = evaluate(
    React,
    exports,
    module,
    requireRuntimeDependency
  ) as unknown

  if (typeof component !== "function") {
    throw new Error(
      `Runtime extension "${extension.title}" must export a component.`
    )
  }

  return component as React.ComponentType<ExtensionProps>
}

function createRuntimeExtensionWrapper(extension: OusiaRuntimeExtension) {
  let Component: React.ComponentType<ExtensionProps> | undefined
  return function RuntimeExtensionApp(props: ExtensionProps) {
    Component ??= createRuntimeComponent(extension)
    return <Component {...props} />
  }
}

function RuntimeExtensionErrorPanel({
  error,
}: {
  error: OusiaRuntimeExtensionError
}) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-card p-4 text-sm text-card-foreground shadow-sm">
      <div className="font-medium">{error.title} failed to load</div>
      <div className="mt-1 text-muted-foreground">{error.message}</div>
      <div className="mt-2 text-xs text-muted-foreground">
        User-local extension
      </div>
      {error.sourcePath ? (
        <div className="mt-3 rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all text-muted-foreground">
          {error.sourcePath}
        </div>
      ) : null}
    </div>
  )
}

export function runtimeExtensionsToDefinitions(
  extensions: OusiaRuntimeExtension[],
  errors: OusiaRuntimeExtensionError[]
): ExtensionDefinition[] {
  return [
    ...extensions.map((extension) => ({
      id: extension.id,
      title: extension.title,
      slot: extension.slot,
      kind: "runtime" as const,
      distribution: extension.distribution,
      trust: extension.trust,
      component: createRuntimeExtensionWrapper(extension),
    })),
    ...errors.map((error) => ({
      id: error.id,
      title: error.title,
      slot: "workspace.tab" as const,
      kind: "runtime" as const,
      distribution: error.distribution,
      trust: error.trust,
      component: () => <RuntimeExtensionErrorPanel error={error} />,
    })),
  ]
}
