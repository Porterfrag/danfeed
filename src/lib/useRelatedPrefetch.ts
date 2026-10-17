import { useEffect } from 'react'
import type { MediaItem } from '../types'
import { relatedSubject, warmRelated } from './related'

/**
 * Ask for the related tags of whichever slide is in front, before anyone asks for them.
 *
 * Only once the sheet has been used in this browser (`enabled`): this costs a request per slide,
 * and a request per slide for a list nobody opens is a tax on somebody else's server. After the
 * first look, the list is usually waiting by the time the button is pressed.
 *
 * Debounced, because a flick through ten slides should warm the one that settles rather than all
 * ten — and because a slide that stays on screen is the one whose sheet can actually be opened.
 */
export function useRelatedPrefetch(item: MediaItem | undefined, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !item) return

    const subject = relatedSubject(item)
    if (!subject) return

    const timer = setTimeout(() => warmRelated(subject.tag), 400)
    return () => clearTimeout(timer)
  }, [item, enabled])
}
