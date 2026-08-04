import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

type ToastVariant = "default" | "error"

type ToastOptions = {
  duration?: number
  variant?: ToastVariant
}

type ToastItem = {
  id: number
  message: string
  variant: ToastVariant
}

type ToastContextValue = {
  toast: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextIdRef = useRef(0)

  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const id = ++nextIdRef.current
    setItems((current) => [
      ...current,
      { id, message, variant: options.variant ?? "default" },
    ])
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id))
    }, options.duration ?? 2200)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          aria-atomic="false"
          className="pointer-events-none fixed right-5 bottom-5 z-[100] grid max-w-sm gap-2"
        >
          {items.map((item) => (
            <div
              className={cn(
                "animate-in fade-in slide-in-from-bottom-2 rounded-lg border bg-popover px-3.5 py-2.5 text-sm text-popover-foreground shadow-lg",
                item.variant === "error" &&
                  "border-destructive/40 text-destructive"
              )}
              key={item.id}
              role={item.variant === "error" ? "alert" : "status"}
            >
              {item.message}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider")
  }
  return context.toast
}
