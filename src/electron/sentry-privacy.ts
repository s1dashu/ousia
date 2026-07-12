import type { Event, StackFrame, Thread } from "@sentry/electron/main"

const SAFE_CONTEXT_KEYS = new Set(["app", "os", "runtime", "trace"])
const SAFE_TAG_KEYS = new Set([
  "error_code",
  "handled",
  "operation",
  "retryable",
  "subsystem",
])

function privatePath(value: string | undefined) {
  return value
    ?.replace(/\/Users\/[^/]+\//g, "~/")
    .replace(/[A-Za-z]:\\Users\\[^\\]+\\/g, "~\\")
    .replace(/\/home\/[^/]+\//g, "~/")
}

function safeFrame(frame: StackFrame): StackFrame {
  const safe = { ...frame }
  delete safe.vars
  safe.abs_path = privatePath(safe.abs_path)
  safe.filename = privatePath(safe.filename)
  return safe
}

function safeThread(thread: Thread): Thread {
  return {
    ...thread,
    stacktrace: thread.stacktrace
      ? {
          ...thread.stacktrace,
          frames: thread.stacktrace.frames?.map(safeFrame),
        }
      : undefined,
  }
}

export function sanitizeSentryEvent<T extends Event>(
  event: T,
  productId: string,
  processType: "main" | "preload" | "renderer"
): T {
  const safeContexts = Object.fromEntries(
    Object.entries(event.contexts || {}).filter(([key]) =>
      SAFE_CONTEXT_KEYS.has(key)
    )
  )
  const safeTags = Object.fromEntries(
    Object.entries(event.tags || {}).filter(([key]) => SAFE_TAG_KEYS.has(key))
  )
  return {
    ...event,
    breadcrumbs: undefined,
    contexts: safeContexts,
    exception: event.exception
      ? {
          ...event.exception,
          values: event.exception.values?.map((value) => ({
            ...value,
            value: value.type || "Error",
            stacktrace: value.stacktrace
              ? {
                  ...value.stacktrace,
                  frames: value.stacktrace.frames?.map(safeFrame),
                }
              : undefined,
          })),
        }
      : undefined,
    extra: undefined,
    fingerprint: undefined,
    logentry: undefined,
    message: undefined,
    request: undefined,
    server_name: undefined,
    tags: {
      ...safeTags,
      process_type: processType,
      product_id: productId,
    },
    threads: event.threads
      ? { ...event.threads, values: event.threads.values?.map(safeThread) }
      : undefined,
    user: undefined,
  } as T
}
