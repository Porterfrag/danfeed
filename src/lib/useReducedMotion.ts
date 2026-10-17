import { useEffect, useState } from 'react'

/** The query and the read are kept together: a one-off read is easy to get wrong. */
const QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.(QUERY).matches ?? false
}

/**
 * Whether the browser is asking for less motion.
 *
 * Used for the two things that move by themselves: the animated sheets. Snap scrolling still
 * snaps — that is navigation, not decoration — but it stops gliding, videos stop starting on
 * their own, and the small fades are dropped. Watched rather than read once, because the
 * setting can be changed while the tab is open (and because a phone may report a different
 * answer in battery saver).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return reduced
}
