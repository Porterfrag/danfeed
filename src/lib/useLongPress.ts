import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'

/** How long a press has to hold before it counts as a long press. */
const HOLD_MS = 450
/** Movement that cancels a hold: a scroll or a drag is not a press. */
const SLOP_PX = 10
/**
 * How long after a hold a click still counts as that hold's own.
 *
 * The click follows the pointer coming up, which is milliseconds after the sheet appears. A
 * longer window would start eating the next tap; a shorter one would let a deliberate hold also
 * search, which is the thing the sheet exists to avoid.
 */
const CLICK_WINDOW_MS = 400

/**
 * Long press, right click and Shift+F10, for a second action on something that already has a
 * first one.
 *
 * Tags on a slide search on tap. The extra actions — Danbooru's own page, the wiki, the link —
 * need somewhere to live that is not another visible control on every chip, and touch has no
 * second button, so the hold is the only gesture left. The browser turns right-click, the
 * context-menu key and Shift+F10 into the same `contextmenu` event, which is how a keyboard
 * reaches this too.
 *
 * The click that follows a hold is swallowed: the sheet is already open, and letting the tap
 * through as well would start a search nobody asked for.
 */
export function useLongPress(onLongPress: () => void) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  /**
   * When the hold last fired, for deciding whether a click belongs to it.
   *
   * A timestamp rather than a flag: the click that follows a hold arrives within a frame or two
   * of the pointer coming up, but a flag would still be set minutes later, and would then eat the
   * next activation of the chip — the keyboard's, which arrives as a bare click with no pointer
   * before it.
   */
  const firedAt = useRef(0)

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    origin.current = null
    setHolding(false)
  }, [])

  useEffect(() => stop, [stop])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Only the primary button holds; a right-click has its own handler below.
      if (e.button !== 0) return
      origin.current = { x: e.clientX, y: e.clientY }
      setHolding(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setHolding(false)
        firedAt.current = Date.now()
        onLongPress()
      }, HOLD_MS)
    },
    [onLongPress],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const start = origin.current
      if (!start || timer.current === null) return
      if (Math.abs(e.clientX - start.x) > SLOP_PX || Math.abs(e.clientY - start.y) > SLOP_PX) stop()
    },
    [stop],
  )

  const onContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault()
      stop()
      firedAt.current = Date.now()
      onLongPress()
    },
    [onLongPress, stop],
  )

  /** Swallows the click that follows a hold or a right-click, and only that one. */
  const onClick = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    if (Date.now() - firedAt.current > CLICK_WINDOW_MS) return
    firedAt.current = 0
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return {
    /** True while the hold is in progress, for a pressed look before the sheet opens. */
    holding,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onContextMenu,
      onClick,
    },
  }
}
