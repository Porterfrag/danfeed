import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaItem } from '../types'
import { BooruError, searchPosts } from '../lib/danbooru'
import { analyzeTags, removeToken, TAG_LIMIT, tokenize } from '../lib/tagQuery'

export const CHIPS = [
  { id: 'all', label: 'All', tags: '' },
  { id: 'videos', label: 'Videos', tags: 'video' },
  { id: 'photos', label: 'Photos', tags: '-animated' },
  { id: 'animated', label: 'Animated', tags: 'animated' },
  // `order:score` over the whole database times out (500 QueryCanceled), and
  // `order:rank` would consume one of the two search slots. `score:>` is both
  // fast and free, so it keeps the full tag budget available.
  { id: 'top', label: 'Top', tags: 'score:>200' },
] as const

export type ChipId = (typeof CHIPS)[number]['id']

/** Shown when the query exceeds the API limit; the request is never sent. */
export interface TagLimitState {
  tokens: string[]
  limit: number
  /** Tokens contributed by the active filter chip rather than the text box. */
  filterTokens: string[]
}

const PAGE_SIZE = 20
/** Keep paginating until we have something new, so a heavy "seen" history never stalls the feed. */
const MAX_SCAN_PAGES = 6

export function useFeed() {
  const [chip, setChip] = useState<ChipId>('all')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<BooruError | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [tagLimit, setTagLimit] = useState<TagLimitState | null>(null)
  const [homeSignal, setHomeSignal] = useState(0)

  const cursorRef = useRef<string | null>(null)
  const hasMoreRef = useRef(true)
  const loadingRef = useRef(false)
  const genRef = useRef(0)
  const keysRef = useRef<Set<string>>(new Set())
  // Session-only: persisting this across reloads made the feed come back empty
  // ("all caught up") on every refresh, because page 1 was always already seen.
  const seenRef = useRef<Set<string>>(new Set())
  const overLimitRef = useRef(false)

  const chipTags = useMemo(() => CHIPS.find((c) => c.id === chip)?.tags ?? '', [chip])

  const tags = useMemo(
    () => [chipTags, query].filter(Boolean).join(' '),
    [chipTags, query],
  )

  const tagsRef = useRef(tags)

  // Sync the ref in an effect rather than during render.
  useEffect(() => {
    tagsRef.current = tags
  }, [tags])

  // Debounce typing so a search is one request, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput.trim()), 450)
    return () => clearTimeout(timer)
  }, [queryInput])

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return
    // Never send a query the API will reject.
    if (overLimitRef.current) return

    loadingRef.current = true
    setLoading(true)
    setError(null)

    const gen = genRef.current
    // Marks that this call owns the loading flag, so a superseded call can still release it.
    let ownedLoading = true

    try {
      let cursor = cursorRef.current
      let exhausted = false
      let pages = 0
      const collected: MediaItem[] = []
      const batchKeys: string[] = []

      while (pages < MAX_SCAN_PAGES && collected.length < 12 && !exhausted) {
        const page = await searchPosts(tagsRef.current, cursor, PAGE_SIZE)
        pages += 1
        cursor = page.next
        if (!page.next) exhausted = true
        if (page.items.length === 0) exhausted = true

        for (const item of page.items) {
          // Collect into a local batch first: if this call turns out to be stale,
          // it must not leave keys behind that poison the next request's dedupe.
          if (keysRef.current.has(item.key)) continue
          if (batchKeys.includes(item.key)) continue
          batchKeys.push(item.key)
          collected.push(item)
        }
      }

      if (gen !== genRef.current) return

      // Commit the batch only once it is known to be current.
      for (const key of batchKeys) keysRef.current.add(key)

      if (collected.length === 0) {
        hasMoreRef.current = false
        setHasMore(false)
        return
      }

      cursorRef.current = cursor
      hasMoreRef.current = !exhausted
      setHasMore(!exhausted)
      setItems((prev) => [...prev, ...collected])

      for (const item of collected) seenRef.current.add(item.key)
    } catch (caught) {
      if (gen !== genRef.current) return
      setError(
        caught instanceof BooruError
          ? caught
          : new BooruError('network', 'Something went wrong while loading.'),
      )
    } finally {
      if (ownedLoading) {
        ownedLoading = false
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [])

  const reset = useCallback(() => {
    genRef.current += 1
    keysRef.current = new Set()
    cursorRef.current = null
    hasMoreRef.current = true
    loadingRef.current = false
    setItems([])
    setError(null)
    setHasMore(true)
    setLoading(false)
  }, [])

  const retry = useCallback(() => {
    reset()
    void loadMore()
  }, [reset, loadMore])

  const clearHistory = useCallback(() => {
    seenRef.current = new Set()
    reset()
    void loadMore()
  }, [reset, loadMore])

  /** Drop one over-limit tag, choosing the right place to remove it from. */
  const removeTag = useCallback(
    (raw: string) => {
      const fromFilter = tokenize(chipTags).includes(raw)
      if (fromFilter) {
        // The tag came from the filter chip, so the chip is what must change.
        setChip('all')
        return
      }
      setQueryInput((current) => removeToken(current, raw))
    },
    [chipTags],
  )

  /**
   * Return to a pristine feed, the same state a page reload would give:
   * no search, no filter chip, and no view history.
   *
   * Clearing the history matters — without it the reload would skip everything
   * already scrolled past and resume mid-stream instead of showing the newest
   * posts again.
   */
  const resetToDefault = useCallback(() => {
    seenRef.current = new Set()
    setQueryInput('')
    setQuery('') // assign directly so the reload does not wait on the debounce
    setChip('all')
    // Guarantees the reload even when the tags are already at their defaults.
    setHomeSignal((n) => n + 1)
  }, [])

  useEffect(() => {
    const analysis = analyzeTags(tags)
    overLimitRef.current = analysis.over

    reset()

    if (analysis.over) {
      const filterTokens = analyzeTags(chipTags).counted
      setTagLimit({ tokens: analysis.counted, limit: TAG_LIMIT, filterTokens })
      return
    }

    setTagLimit(null)
    void loadMore()
  }, [tags, chipTags, reset, loadMore, homeSignal])

  return {
    items,
    loading,
    error,
    hasMore,
    tagLimit,
    removeTag,
    chip,
    setChip,
    queryInput,
    setQueryInput,
    loadMore,
    retry,
    clearHistory,
    resetToDefault,
  }
}

export type FeedState = ReturnType<typeof useFeed>
