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
  throw new Error(`运行时扩展依赖不可用：${name}`)
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
      `运行时扩展「${extension.title}」必须导出一个组件。`
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

function formatDistribution(value: OusiaRuntimeExtensionError["distribution"]) {
  if (value === "user-local") {
    return "本地用户扩展"
  }
  return value
}

function formatTrust(value: OusiaRuntimeExtensionError["trust"]) {
  if (value === "local-user") {
    return "本地用户"
  }
  return value
}

function RuntimeExtensionErrorPanel({
  error,
}: {
  error: OusiaRuntimeExtensionError
}) {
  return (
    <div className="ousia-hover-scrollbar flex h-full min-h-0 flex-col overflow-auto bg-background p-6 text-card-foreground">
      <div className="mx-auto w-full max-w-3xl">
        <div className="text-xs font-medium text-destructive">
          运行时扩展错误
        </div>
        <h2 className="mt-2 text-xl font-semibold">{error.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Ousia 加载这个本地用户扩展的运行时包时失败。修复扩展文件后，
          文件监听刷新时会自动重试。
        </p>

        <section className="mt-5 rounded-lg border border-destructive/30 bg-card p-4">
          <div className="text-sm font-medium">加载错误</div>
          <pre className="ousia-hover-scrollbar mt-3 max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {error.message}
          </pre>
        </section>

        <dl className="mt-5 grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
          <dt className="text-muted-foreground">ID</dt>
          <dd className="min-w-0 break-all font-mono text-xs">{error.id}</dd>
          <dt className="text-muted-foreground">分发类型</dt>
          <dd>{formatDistribution(error.distribution)}</dd>
          <dt className="text-muted-foreground">信任级别</dt>
          <dd>{formatTrust(error.trust)}</dd>
          {error.extensionDir ? (
            <>
              <dt className="text-muted-foreground">扩展目录</dt>
              <dd className="min-w-0 break-all font-mono text-xs">
                {error.extensionDir}
              </dd>
            </>
          ) : null}
          {error.sourcePath ? (
            <>
              <dt className="text-muted-foreground">来源</dt>
              <dd className="min-w-0 break-all font-mono text-xs">
                {error.sourcePath}
              </dd>
            </>
          ) : null}
        </dl>
      </div>
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
