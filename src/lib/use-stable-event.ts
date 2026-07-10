import { useCallback, useLayoutEffect, useRef } from "react"

type AnyFunction = (...args: never[]) => unknown

/**
 * Keeps a callback identity stable while invoking the latest committed
 * implementation. This lets memoized shell surfaces ignore unrelated chat
 * stream renders without retaining stale state in their event handlers.
 */
export function useStableEvent<T extends AnyFunction>(handler: T): T {
  const handlerRef = useRef(handler)

  useLayoutEffect(() => {
    handlerRef.current = handler
  }, [handler])

  const stableHandler = useCallback(
    (...args: Parameters<T>) => handlerRef.current(...args),
    []
  )

  return stableHandler as T
}
