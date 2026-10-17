import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

export interface ZoomState {
  s: number
  x: number
  y: number
}

const MIN_SCALE = 1
const MAX_SCALE = 5

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

function bounds(scale: number, width: number, height: number) {
  return {
    mx: Math.max(0, ((scale - 1) * width) / 2),
    my: Math.max(0, ((scale - 1) * height) / 2),
  }
}

/**
 * Double-tap / pinch zoom with panning for still images.
 * `touch-action` is flipped to `none` while zoomed so dragging pans instead of scrolling.
 */
export function useZoom(ref: RefObject<HTMLDivElement | null>) {
  const [state, setState] = useState<ZoomState>({ s: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const stateRef = useRef(state)

  // Keep the ref current without writing to it during render.
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const pan = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  const reset = useCallback(() => {
    setState({ s: 1, x: 0, y: 0 })
    setDragging(false)
  }, [])

  const zoomTo = useCallback(
    (target: number, clientX?: number, clientY?: number) => {
      const el = ref.current
      const scale = clampScale(target)

      if (!el) {
        setState({ s: scale, x: 0, y: 0 })
        return
      }

      const rect = el.getBoundingClientRect()
      const px = clientX == null ? rect.width / 2 : clientX - rect.left
      const py = clientY == null ? rect.height / 2 : clientY - rect.top

      setState((prev) => {
        if (scale <= 1.01) return { s: 1, x: 0, y: 0 }
        const ratio = scale / prev.s
        const { mx, my } = bounds(scale, rect.width, rect.height)
        return {
          s: scale,
          x: Math.max(-mx, Math.min(mx, px - (px - prev.x) * ratio)),
          y: Math.max(-my, Math.min(my, py - (py - prev.y) * ratio)),
        }
      })
    },
    [ref],
  )

  const toggle = useCallback(
    (clientX?: number, clientY?: number) => {
      zoomTo(stateRef.current.s > 1.01 ? 1 : 2.5, clientX, clientY)
    },
    [zoomTo],
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        pinch.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          scale: stateRef.current.s,
        }
        pan.current = null
        setDragging(true)
      } else if (pointers.current.size === 1 && stateRef.current.s > 1) {
        pan.current = {
          px: e.clientX,
          py: e.clientY,
          x: stateRef.current.x,
          y: stateRef.current.y,
        }
        setDragging(true)
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()

      if (pointers.current.size === 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const scale = clampScale(pinch.current.scale * (dist / Math.max(1, pinch.current.dist)))
        const { mx, my } = bounds(scale, rect.width, rect.height)
        setState((prev) => ({
          s: scale,
          x: scale <= 1.01 ? 0 : Math.max(-mx, Math.min(mx, prev.x)),
          y: scale <= 1.01 ? 0 : Math.max(-my, Math.min(my, prev.y)),
        }))
        return
      }

      if (pointers.current.size === 1 && pan.current) {
        const { mx, my } = bounds(stateRef.current.s, rect.width, rect.height)
        const x = pan.current.x + (e.clientX - pan.current.px)
        const y = pan.current.y + (e.clientY - pan.current.py)
        setState({
          s: stateRef.current.s,
          x: Math.max(-mx, Math.min(mx, x)),
          y: Math.max(-my, Math.min(my, y)),
        })
      }
    },
    [ref],
  )

  const endPointer = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      pan.current = null
      setDragging(false)
      setState((prev) => (prev.s <= 1.02 ? { s: 1, x: 0, y: 0 } : prev))
    }
  }, [])

  return {
    state,
    dragging,
    reset,
    zoomTo,
    toggle,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
  }
}
