"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion"

import { cn } from "@/lib/utils"
import {
  cancelTooltipPositionUpdate,
  scheduleTooltipPositionUpdate,
} from "@/components/ui/tooltip-position"

type TooltipSide = "top" | "bottom" | "left" | "right"

type TooltipPosition = {
  left: number
  top: number
  side: TooltipSide
}

type TooltipContextValue = {
  animationFrameRef: React.MutableRefObject<number | null>
  isHovered: boolean
  position: TooltipPosition | undefined
  setIsHovered: React.Dispatch<React.SetStateAction<boolean>>
  sideOffsetRef: React.MutableRefObject<number>
  sideRef: React.MutableRefObject<TooltipSide>
  updatePosition: (target: HTMLElement, clientX?: number) => void
  x: MotionValue<number>
}

type TooltipProviderProps = React.PropsWithChildren<{
  delayDuration?: number
  disableHoverableContent?: boolean
  skipDelayDuration?: number
}>

type TooltipProps = React.PropsWithChildren<{
  defaultOpen?: boolean
  delayDuration?: number
  disableHoverableContent?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
}>

type TooltipTriggerProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean
}

type TooltipContentProps = React.HTMLAttributes<HTMLSpanElement> & {
  align?: "start" | "center" | "end"
  side?: TooltipSide
  sideOffset?: number
}

const TooltipContext = React.createContext<TooltipContextValue | null>(null)

function useTooltipContext(componentName: string) {
  const context = React.useContext(TooltipContext)

  if (!context) {
    throw new Error(`${componentName} must be used within Tooltip`)
  }

  return context
}

function getHorizontalPosition(rect: DOMRect) {
  const baseLeft = Math.min(
    Math.max(rect.left + rect.width / 2, 88),
    window.innerWidth - 88
  )

  return { baseLeft }
}

function getTransformOrigin(side: TooltipSide) {
  switch (side) {
    case "bottom":
      return "top center"
    case "left":
      return "right center"
    case "right":
      return "left center"
    case "top":
    default:
      return "bottom center"
  }
}

function getInitialMotion(side: TooltipSide) {
  switch (side) {
    case "bottom":
      return { opacity: 0, y: -20, scale: 0.6 }
    case "left":
      return { opacity: 0, x: 20, scale: 0.6 }
    case "right":
      return { opacity: 0, x: -20, scale: 0.6 }
    case "top":
    default:
      return { opacity: 0, y: 20, scale: 0.6 }
  }
}

function getPlacementClassName(side: TooltipSide) {
  switch (side) {
    case "bottom":
      return "-translate-x-1/2"
    case "left":
      return "-translate-x-full -translate-y-1/2"
    case "right":
      return "-translate-y-1/2"
    case "top":
    default:
      return "-translate-x-1/2 -translate-y-full"
  }
}

function TooltipProvider({ children }: TooltipProviderProps) {
  return <>{children}</>
}

function Tooltip({
  children,
  defaultOpen = false,
  onOpenChange,
  open,
}: TooltipProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const [position, setPosition] = React.useState<TooltipPosition | undefined>()
  const x = useMotionValue(0)
  const animationFrameRef = React.useRef<number | null>(null)
  const sideRef = React.useRef<TooltipSide>("top")
  const sideOffsetRef = React.useRef(12)
  const isControlled = open !== undefined
  const isHovered = isControlled ? open : uncontrolledOpen

  const setIsHovered = React.useCallback(
    (nextOpen: React.SetStateAction<boolean>) => {
      const resolvedOpen =
        typeof nextOpen === "function" ? nextOpen(isHovered) : nextOpen

      if (!isControlled) {
        setUncontrolledOpen(resolvedOpen)
      }

      onOpenChange?.(resolvedOpen)
    },
    [isControlled, isHovered, onOpenChange]
  )

  const updatePosition = React.useCallback(
    (target: HTMLElement, clientX?: number) => {
      const rect = target.getBoundingClientRect()
      const preferredSide = sideRef.current
      const sideOffset = sideOffsetRef.current

      if (preferredSide === "left" || preferredSide === "right") {
        const canUseLeft = rect.left > 120
        const canUseRight = window.innerWidth - rect.right > 120
        const nextSide =
          preferredSide === "left" && !canUseLeft && canUseRight
            ? "right"
            : preferredSide === "right" && !canUseRight && canUseLeft
              ? "left"
              : preferredSide
        const nextLeft =
          nextSide === "right"
            ? rect.right + sideOffset
            : rect.left - sideOffset
        const nextTop = Math.min(
          Math.max(rect.top + rect.height / 2, 48),
          window.innerHeight - 48
        )

        setPosition({ left: nextLeft, top: nextTop, side: nextSide })
      } else {
        const canUseTop = rect.top > 84
        const canUseBottom = window.innerHeight - rect.bottom > 84
        const nextSide =
          preferredSide === "top" && !canUseTop && canUseBottom
            ? "bottom"
            : preferredSide === "bottom" && !canUseBottom && canUseTop
              ? "top"
              : preferredSide
        const { baseLeft } = getHorizontalPosition(rect)
        const baseTop =
          nextSide === "bottom"
            ? rect.bottom + sideOffset
            : rect.top - sideOffset

        setPosition({ left: baseLeft, top: baseTop, side: nextSide })
      }

      if (clientX !== undefined) {
        x.set(clientX - rect.left - rect.width / 2)
      }
    },
    [x]
  )

  React.useEffect(() => {
    const currentAnimationFrameRef = animationFrameRef

    return () => {
      cancelTooltipPositionUpdate(
        currentAnimationFrameRef,
        cancelAnimationFrame
      )
    }
  }, [])

  const contextValue = React.useMemo(
    () => ({
      animationFrameRef,
      isHovered,
      position,
      setIsHovered,
      sideOffsetRef,
      sideRef,
      updatePosition,
      x,
    }),
    [isHovered, position, setIsHovered, updatePosition, x]
  )

  return (
    <TooltipContext.Provider value={contextValue}>
      {children}
    </TooltipContext.Provider>
  )
}

function TooltipTrigger({
  asChild,
  children,
  className,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  ...props
}: TooltipTriggerProps) {
  const context = useTooltipContext("TooltipTrigger")
  const { animationFrameRef, setIsHovered, updatePosition } = context

  const handleMouseEnter = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      updatePosition(event.currentTarget, event.clientX)
      setIsHovered(true)
    },
    [setIsHovered, updatePosition]
  )

  const handleMouseLeave = React.useCallback(() => {
    cancelTooltipPositionUpdate(animationFrameRef, cancelAnimationFrame)
    setIsHovered(false)
  }, [animationFrameRef, setIsHovered])

  const handleMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      // React clears currentTarget after the event handler returns. Keep only
      // the DOM/value snapshots that the deferred frame needs.
      const target = event.currentTarget
      const clientX = event.clientX
      scheduleTooltipPositionUpdate({
        animationFrameRef,
        cancelFrame: cancelAnimationFrame,
        clientX,
        requestFrame: requestAnimationFrame,
        target,
        updatePosition,
      })
    },
    [animationFrameRef, updatePosition]
  )

  const handleFocus = React.useCallback(
    (event: React.FocusEvent<HTMLElement>) => {
      updatePosition(event.currentTarget)
      setIsHovered(true)
    },
    [setIsHovered, updatePosition]
  )

  const handleBlur = React.useCallback(() => {
    setIsHovered(false)
  }, [setIsHovered])

  const triggerProps = {
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      onBlur?.(event)
      handleBlur()
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      onFocus?.(event)
      handleFocus(event)
    },
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      onMouseEnter?.(event)
      handleMouseEnter(event)
    },
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
      onMouseLeave?.(event)
      handleMouseLeave()
    },
    onMouseMove: (event: React.MouseEvent<HTMLElement>) => {
      onMouseMove?.(event)
      handleMouseMove(event)
    },
  }

  if (asChild && React.isValidElement(children)) {
    const child = React.Children.only(children) as React.ReactElement<
      React.HTMLAttributes<HTMLElement>
    >
    const childProps = child.props

    return React.cloneElement(child, {
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        childProps.onBlur?.(event)
        triggerProps.onBlur(event)
      },
      onFocus: (event: React.FocusEvent<HTMLElement>) => {
        childProps.onFocus?.(event)
        triggerProps.onFocus(event)
      },
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onMouseEnter?.(event)
        triggerProps.onMouseEnter(event)
      },
      onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onMouseLeave?.(event)
        triggerProps.onMouseLeave(event)
      },
      onMouseMove: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onMouseMove?.(event)
        triggerProps.onMouseMove(event)
      },
    })
  }

  return (
    <span
      data-slot="tooltip-trigger"
      className={cn("relative inline-flex", className)}
      {...props}
      {...triggerProps}
    >
      {children}
    </span>
  )
}

function TooltipContent({
  align = "center",
  children,
  className,
  side = "top",
  sideOffset = 12,
  ...props
}: TooltipContentProps) {
  const context = useTooltipContext("TooltipContent")
  const { isHovered, position, sideOffsetRef, sideRef, x } = context
  const springConfig = { stiffness: 180, damping: 22 }
  const rotate = useSpring(useTransform(x, [-120, 120], [-4, 4]), springConfig)
  const translateX = useSpring(
    useTransform(x, [-120, 120], [-10, 10]),
    springConfig
  )
  const initialMotion = getInitialMotion(position?.side ?? side)

  void align

  React.useEffect(() => {
    sideRef.current = side
    sideOffsetRef.current = sideOffset
  }, [side, sideOffset, sideOffsetRef, sideRef])

  if (typeof document === "undefined") {
    return null
  }

  return createPortal(
    <AnimatePresence>
      {isHovered && position ? (
        <motion.span
          initial={initialMotion}
          animate={{
            opacity: 1,
            y: 0,
            x: 0,
            scale: 1,
            transition: {
              type: "spring",
              stiffness: 260,
              damping: 10,
            },
          }}
          exit={initialMotion}
          style={{
            left: position.left,
            top: position.top,
            translateX,
            rotate,
            whiteSpace: "nowrap",
            transformOrigin: getTransformOrigin(position.side),
          }}
          className={cn(
            "pointer-events-none fixed z-[9999] flex flex-col items-center justify-center rounded-md bg-black px-4 py-2 text-xs text-white shadow-xl",
            getPlacementClassName(position.side),
            className
          )}
          {...props}
        >
          <span className="absolute inset-x-10 -bottom-px z-30 h-px w-[20%] bg-gradient-to-r from-transparent via-[var(--radix-scale-9)] to-transparent" />
          <span className="absolute -bottom-px left-10 z-30 h-px w-[40%] bg-gradient-to-r from-transparent via-[var(--ring)] to-transparent" />
          <span className="relative z-30 text-center text-xs leading-tight font-semibold whitespace-pre text-white tabular-nums">
            {children}
          </span>
        </motion.span>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
