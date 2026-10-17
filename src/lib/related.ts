/**
 * Related tags: what to look at next, and what to ask for before anyone is looking.
 *
 * Danbooru's own `related_tag.json` answers "what usually appears alongside this tag", so the
 * discovery part of this file is mostly about *when* to ask. The strategy is deliberately two
 * speeds:
 *
 * - Opening the sheet asks, and shows a line saying it is asking. That is the normal path.
 * - A slide that settles in front, once this browser has opened the sheet at least once, asks in
 *   the background so the sheet opens with the answer already in hand. The gate matters: without
 *   it this is one request per slide for a sheet nobody has ever opened, which is a tax on
 *   somebody else's server.
 *
 * Answers are cached for the session, empty ones included — "nothing is related to this" is an
 * answer, and asking again every time the same tag comes past would be the same request twice.
 */
import type { MediaItem } from '../types'
import { relatedTags } from './danbooru'
import type { RelatedTag } from './danbooru'

export type { RelatedTag }

/** Which family the subject came from. Only ever used for wording. */
export type RelatedKind = 'artist' | 'character' | 'series'

export interface RelatedSubject {
  tag: string
  kind: RelatedKind
}

/**
 * The tag a slide is most identifiable by, or null when there is none.
 *
 * The artist first: "more like this artist" is a body of work. Then the character, then the
 * series. General tags are deliberately not a fallback — they describe what is in the picture
 * rather than what to look at next, and the related list for `1girl` is most of the site.
 */
export function relatedSubject(item: MediaItem): RelatedSubject | null {
  const artist = item.artists[0]
  if (artist) return { tag: artist, kind: 'artist' }

  const character = item.characters[0]
  if (character) return { tag: character, kind: 'character' }

  const series = item.copyrights[0]
  if (series) return { tag: series, kind: 'series' }

  return null
}

const cache = new Map<string, RelatedTag[]>()
const running = new Map<string, Promise<RelatedTag[]>>()

/** The answer for a tag, when it is already here. Lets the sheet skip its loading line. */
export function cachedRelated(tag: string): RelatedTag[] | undefined {
  return cache.get(tag)
}

/**
 * Fetch one tag's related list, once per session.
 *
 * The sheet and the warmer share this, so a warm that is still in flight when the sheet opens
 * is joined rather than repeated — the sheet waits on the same request instead of starting one.
 */
export function loadRelated(tag: string): Promise<RelatedTag[]> {
  const known = cache.get(tag)
  if (known) return Promise.resolve(known)

  const pending = running.get(tag)
  if (pending) return pending

  const request = relatedTags(tag)
    .then((related) => {
      cache.set(tag, related)
      return related
    })
    .finally(() => running.delete(tag))

  running.set(tag, request)
  return request
}

/**
 * Ask for a tag's related list without anyone waiting on it.
 *
 * Failures are the sheet's problem, not this one's: a prefetch that fails is not worth a message
 * on screen, and the sheet asks again while the user is watching. Successes, including empty
 * ones, are cached, so the ask is never made twice.
 */
export function warmRelated(tag: string): void {
  if (cache.has(tag) || running.has(tag)) return
  void loadRelated(tag).catch(() => undefined)
}
