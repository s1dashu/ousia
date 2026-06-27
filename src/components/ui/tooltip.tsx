"use client"

import * as React from "react"
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type TooltipSide = NonNullable<
  React.ComponentProps<typeof TooltipPrimitive.Content>["side"]
>

type TooltipMotionContextValue = {
  pointerX: MotionValue<number>
}

const TooltipMotionContext =
  React.createContext<TooltipMotionContextValue | null>(null)

const tooltipSpring = {
  stiffness: 260,
  damping: 10,
  mass: 0.7,
}

const tooltipPointerSpring = {
  stiffness: 180,
  damping: 22,
}

function getInitialOffset(side: TooltipSide) {
  switch (side) {
    case "bottom":
      return { x: 0, y: -20 }
    case "left":
      return { x: 16, y: 0 }
    case "right":
      return { x: -16, y: 0 }
    case "top":
    default:
      return { x: 0, y: 20 }
  }
}

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const pointerX = useMotionValue(0)
  const motionContextValue = React.useMemo(
    () => ({ pointerX }),
    [pointerX]
  )

  return (
    <TooltipMotionContext.Provider value={motionContextValue}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipMotionContext.Provider>
  )
}

function TooltipTrigger({
  onBlur,
  onPointerLeave,
  onPointerMove,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const motionContext = React.useContext(TooltipMotionContext)

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onBlur={(event) => {
        motionContext?.pointerX.set(0)
        onBlur?.(event)
      }}
      onPointerLeave={(event) => {
        motionContext?.pointerX.set(0)
        onPointerLeave?.(event)
      }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        motionContext?.pointerX.set(
          event.clientX - rect.left - rect.width / 2
        )
        onPointerMove?.(event)
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 10,
  align = "center",
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const motionContext = React.useContext(TooltipMotionContext)
  const fallbackPointerX = useMotionValue(0)
  const pointerX = motionContext?.pointerX ?? fallbackPointerX
  const shouldReduceMotion = useReducedMotion()
  const rotate = useSpring(
    useTransform(pointerX, [-120, 120], [-4, 4]),
    tooltipPointerSpring
  )
  const translateX = useSpring(
    useTransform(pointerX, [-120, 120], [-10, 10]),
    tooltipPointerSpring
  )
  const initialOffset = getInitialOffset(side)

  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="pointer-events-none z-50 w-fit outline-none"
        {...props}
      >
        <motion.div
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          className="origin-(--radix-tooltip-content-transform-origin) transform-gpu will-change-transform"
          initial={
            shouldReduceMotion
              ? false
              : {
                  opacity: 0,
                  scale: 0.6,
                  x: initialOffset.x,
                  y: initialOffset.y,
                }
          }
          transition={shouldReduceMotion ? { duration: 0 } : tooltipSpring}
        >
          <motion.div
            className={cn(
              "ousia-rich-tooltip relative flex w-fit max-w-xs flex-col items-center justify-center overflow-hidden rounded-md border border-white/10 bg-neutral-950 px-4 py-2 text-xs text-white shadow-[0_14px_34px_-18px_rgba(0,0,0,0.82),0_4px_14px_-8px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.1)] outline-none has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-4xl",
              className
            )}
            style={
              shouldReduceMotion
                ? undefined
                : {
                    rotate,
                    x: translateX,
                  }
            }
          >
            <span className="relative z-30 min-w-0 whitespace-pre-wrap text-center text-xs leading-tight font-semibold text-white tabular-nums">
              {children}
            </span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-1/2 z-20 h-px w-1/4 -translate-x-1/2 bg-gradient-to-r from-transparent via-[var(--ring)] to-transparent"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-8 z-20 h-px w-2/5 bg-gradient-to-r from-transparent via-[var(--radix-scale-9)] to-transparent"
            />
            <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-neutral-950 fill-neutral-950 data-[side=left]:translate-x-[-1.5px] data-[side=right]:translate-x-[1.5px]" />
          </motion.div>
        </motion.div>
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
