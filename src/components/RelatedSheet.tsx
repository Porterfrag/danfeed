import { useEffect, useState } from 'react'
import { cachedRelated, loadRelated } from '../lib/related'
import type { RelatedTag } from '../lib/related'
import { formatCount, tagLabel } from '../lib/danbooru'
import { categorySpec } from '../lib/tagCategories'
import { Sheet } from './Sheet'
import type { TagTarget } from './TagActionsSheet'
import { IconChevronRight } from './icons'

interface Props {
  /** The tag to find relatives of, or null when the sheet is closed. */
  target: TagTarget | null
  onClose: () => void
  /** Run one of the related tags as a search. */
  onPick: (tag: string) => void
}

/**
 * "More like this": what Danbooru says usually appears next to a tag.
 *
 * The list is the site's own overlap data, not a recommendation: each row says how much of the
 * subject's gallery carries that tag, which is the honest form of "this is more of the same".
 * Every row is a search, so the way onward is the same gesture as everywhere else in the app.
 *
 * The rating is deliberately not part of any of this. Danbooru answers for the tag alone, and
 * the search that follows applies whatever this browser is allowed to show — a related list
 * cannot be a way around the setting.
 */
export function RelatedSheet({ target, onClose, onPick }: Props) {
  const [tags, setTags] = useState<RelatedTag[] | null>(null)
  const [error, setError] = useState('')
  /** Bumped by Try again; re-runs the fetch below. */
  const [attempt, setAttempt] = useState(0)

  const tag = target?.tag ?? null

  useEffect(() => {
    if (!tag) return

    let live = true
    setError('')

    // A prefetch that already landed, or the same tag reopened: no second request, no spinner.
    const known = cachedRelated(tag)
    if (known) {
      setTags(known)
      return
    }

    // Nothing for this tag yet. Clear first: the previous tag's list under a new heading would
    // read as an answer.
    setTags(null)

    loadRelated(tag)
      .then((related) => {
        if (live) setTags(related)
      })
      .catch((caught: unknown) => {
        if (!live) return
        setError(caught instanceof Error ? caught.message : 'Could not load related tags.')
      })

    return () => {
      live = false
    }
  }, [tag, attempt])

  if (!target) return null

  const label = tagLabel(target.tag)
  const noun = target.kind ?? 'tag'
  const listed = tags !== null && tags.length > 0

  return (
    <Sheet open title="More like this" onClose={onClose}>
      <p className="mb-3 px-3 text-2xs leading-relaxed text-white/45">
        Tags Danbooru sees alongside the {noun} <span className="text-white/70">{label}</span>.
      </p>

      {error ? (
        <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
          <p className="text-sm text-white/60">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black"
          >
            Try again
          </button>
        </div>
      ) : tags === null ? (
        <p className="py-8 text-center text-sm text-white/40">
          Looking for tags that go with {label}…
        </p>
      ) : tags.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/40">
          Nothing is related to {label} yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tags.map((entry) => (
            <li key={entry.tag}>
              <button
                type="button"
                onClick={() => onPick(entry.tag)}
                aria-label={`Search ${tagLabel(entry.tag)}`}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left transition hover:bg-white/10 active:bg-white/15"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${categorySpec(entry.category).dot}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white/90">
                    {tagLabel(entry.tag)}
                  </span>
                  <span className="block truncate text-2xs text-white/40">
                    {formatCount(entry.postCount)} posts
                    {entry.frequency > 0
                      ? ` · in ${Math.round(entry.frequency * 100)}% of ${label}`
                      : ''}
                  </span>
                </span>
                <IconChevronRight className="h-4 w-4 shrink-0 text-white/30" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {listed && (
        <p className="mt-3 border-t border-white/10 px-3 pt-3 text-2xs leading-relaxed text-white/35">
          Overlap is measured by Danbooru from the tag's own posts. Searching one applies this
          browser's rating, exactly like any other search.
        </p>
      )}
    </Sheet>
  )
}
