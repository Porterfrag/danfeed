import { useEffect, useState } from 'react'
import { ANNOUNCE_EVENT } from '../lib/announce'

/**
 * The app's one polite live region. Mounted once at the root; `announce()` from lib/announce
 * is how anything reaches it.
 *
 * The zero-width space is not decoration: repeating the same sentence twice ("Saved to your
 * list" after unsaving and saving again) leaves the region's text unchanged, and a region whose
 * text did not change is not announced. Alternating the invisible character keeps every message
 * a change.
 */
export function LiveRegion() {
  const [message, setMessage] = useState('')

  useEffect(() => {
    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<string>).detail
      setMessage((current) => (current === detail || current === `${detail}\u200b` ? `${detail}\u200b` : detail))
    }

    window.addEventListener(ANNOUNCE_EVENT, onAnnounce)
    return () => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce)
  }, [])

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  )
}
