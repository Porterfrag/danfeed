import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../types'
import type { BooruError } from '../lib/danbooru'
import { announce } from '../lib/announce'
import { useReducedMotion } from '../lib/useReducedMotion'
import { useRelatedPrefetch } from '../lib/useRelatedPrefetch'
import { relatedSubject } from '../lib/related'
import { CHIPS } from '../hooks/useFeed'
import type { ChipId } from '../hooks/useFeed'
import logoMark from '../assets/logo-mark.jpg'
import { PostView } from './PostView'
import { TagSearch } from './TagSearch'
import { TagLimitNotice } from './TagLimitNotice'
import { Diagnostic } from './Diagnostic'
import { IconAlert, IconBookmark, IconGear, IconKeyboard, IconPlus } from './icons'
import type { TagLimitState } from '../hooks/useFeed'
import type { TagTarget } from './TagActionsSheet'

interface Props {
  items: MediaItem[]
  loading: boolean
  error: BooruError | null
  hasMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  onClearHistory: () => void
  tagLimit: TagLimitState | null
  onRemoveTag: (token: string) => void
  onClearSearch: () => void
  chip: ChipId
  setChip: (chip: ChipId) => void
  queryInput: string
  setQueryInput: (query: string) => void
  savedKeys: Set<string>
  onSave: (item: MediaItem) => void
  muted: boolean
  onToggleMute: () => void
  maxBytes: number
  scrollToTopSignal: number
  onAddClick: () => void
  onSavedClick: () => void
  onSettingsClick: () => void
  onHomeClick: () => void
  /** Search one tag, whichever category it belongs to. */
  onTagClick: (tag: string) => void
  /** Open the actions sheet for one tag. */
  onTagActions: (target: TagTarget) => void
  /** Open the full tag list for a post. */
  onShowAllTags: (item: MediaItem) => void
  /** Open the keyboard help. */
  onShowShortcuts: () => void
  /**
   * False while a sheet is open. The sheet's own Escape and Tab handling is the only keyboard
   * behaviour that makes sense then; grading the post underneath it does not.
   */
  shortcutsEnabled: boolean
  /** True when the feed is allowed past the general rating. Drives the settings badge. */
  nsfw: boolean
  /** Past searches, newest first, for the box's history panel. */
  recents: string[]
  onClearRecents: () => void
  /** Open the share sheet for a post. */
  onShare: (item: MediaItem) => void
  /** Open the related-tags sheet for one tag. */
  onRelated: (target: TagTarget) => void
  /**
   * Whether this browser has opened the related-tags sheet before. Gates warming the answer for
   * whatever slide is in front: a request per slide is only worth it once it gets looked at.
   */
  relatedUsed: boolean
}

/** Slides left before the next page is asked for. See the effect below. */
const PREFETCH_AHEAD = 3

export function Feed({
  items,
  loading,
  error,
  hasMore,
  onLoadMore,
  onRetry,
  onClearHistory,
  tagLimit,
  onRemoveTag,
  onClearSearch,
  chip,
  setChip,
  queryInput,
  setQueryInput,
  savedKeys,
  onSave,
  muted,
  onToggleMute,
  maxBytes,
  scrollToTopSignal,
  onAddClick,
  onSavedClick,
  onSettingsClick,
  onHomeClick,
  nsfw,
  onTagClick,
  onTagActions,
  onShowAllTags,
  onShowShortcuts,
  shortcutsEnabled,
  recents,
  onClearRecents,
  onShare,
  onRelated,
  relatedUsed,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  /** Bumped by the `/` shortcut; TagSearch focuses its input when it changes. */
  const [focusSignal, setFocusSignal] = useState(0)
  const reduced = useReducedMotion()

  // Which slide owns the screen decides who plays.
  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return

    const observer = new IntersectionObserver(
      (entries) => {
        let best = -1
        let bestRatio = 0
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio
            best = Number((entry.target as HTMLElement).dataset.index)
          }
        }
        if (best >= 0 && bestRatio >= 0.55) setActive(best)
      },
      { root, threshold: [0.55] },
    )

    root.querySelectorAll<HTMLElement>('[data-slide]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [items.length])

  // Infinite scroll.
  useEffect(() => {
    const root = scrollerRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        // An error on screen means the next move is the card's: either its Try again, or the
        // empty feed's own card. Loading again because the bottom of the feed came into view
        // would be a blind retry of a request that just failed.
        if (error !== null) return
        onLoadMore()
      },
      { root, rootMargin: '800px 0px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoadMore, items.length, error])

  /**
   * Fetch ahead of the finger.
   *
   * The sentinel above is where the browser is: it fires when the bottom of the feed comes into
   * range, which on a full-screen feed is about one slide from the end. This is where the reader
   * is — once a few slides are left, the next page is asked for while there is still feed to
   * scroll. By the time the last slide arrives the page has usually landed, and the images that
   * came with it have started loading (`distance <= 3` in PostView).
   *
   * An error stops it for the same reason the sentinel stops: repeated failing requests behind a
   * card that already says what happened is not discovery.
   */
  useEffect(() => {
    if (items.length === 0 || !hasMore || loading || error !== null) return
    if (items.length - active > PREFETCH_AHEAD) return
    onLoadMore()
  }, [active, items.length, hasMore, loading, error, onLoadMore])

  // The related list for whatever is in front, once the sheet has been used in this browser.
  useRelatedPrefetch(items[active], relatedUsed)

  useEffect(() => {
    if (scrollToTopSignal === 0) return
    scrollerRef.current?.scrollTo({ top: 0 })
    setActive(0)
  }, [scrollToTopSignal])

  /**
   * The keyboard layer.
   *
   * Deaf by design while a text field has focus, while a sheet is in front, and to anything with
   * a modifier held: those keys belong to the browser, and a `j` inside a character being built
   * by an input method is not a navigation command either.
   */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      if (!shortcutsEnabled) return

      const target = e.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      const root = scrollerRef.current
      if (!root) return

      const item = items[active]
      // Snap scrolling still snaps — that is navigation, not decoration — but it stops gliding.
      const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth'

      switch (e.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault()
          root.scrollBy({ top: root.clientHeight, behavior })
          break
        case 'ArrowUp':
        case 'k':
        case 'K':
          e.preventDefault()
          root.scrollBy({ top: -root.clientHeight, behavior })
          break
        case ' ': {
          e.preventDefault()
          const video = root.querySelector<HTMLVideoElement>(
            `[data-slide][data-index="${active}"] video`,
          )
          if (video) {
            if (video.paused) {
              void video.play().catch(() => undefined)
              announce('Playing')
            } else {
              video.pause()
              announce('Paused')
            }
          }
          break
        }
        case 'm':
        case 'M':
          onToggleMute()
          break
        case 's':
        case 'S':
          if (item) onSave(item)
          break
        case 'o':
        case 'O':
          if (item?.sourceUrl) window.open(item.sourceUrl, '_blank', 'noopener')
          break
        case 'r':
        case 'R': {
          // The rail's compass, for a keyboard. Slides with no artist, character or series have
          // no subject — the key does nothing there, exactly like the button that is not there.
          const subject = item ? relatedSubject(item) : null
          if (subject) onRelated(subject)
          break
        }
        case '/':
          // Without this, Firefox opens its quick-find bar instead.
          e.preventDefault()
          setFocusSignal((n) => n + 1)
          break
        case 'h':
        case 'H':
          onHomeClick()
          break
        case '?':
          e.preventDefault()
          onShowShortcuts()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    active,
    items,
    onSave,
    onToggleMute,
    onHomeClick,
    onShowShortcuts,
    onRelated,
    reduced,
    shortcutsEnabled,
  ])

  const empty = !loading && items.length === 0 && !tagLimit

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <main className="h-full w-full">
        <div
          ref={scrollerRef}
          role="feed"
          aria-label="Posts"
          aria-busy={loading}
          className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain"
        >
          {items.map((item, index) => (
            <div
              key={item.key}
              data-slide
              data-index={index}
              role="article"
              aria-posinset={index + 1}
              aria-setsize={items.length}
              aria-label={`Post ${index + 1} of ${items.length}`}
              className="h-dvh w-full snap-start snap-always"
            >
              <PostView
                item={item}
                index={index}
                active={index === active}
                distance={Math.abs(index - active)}
                saved={savedKeys.has(item.key)}
                muted={muted}
                maxBytes={maxBytes}
                onSave={onSave}
                onToggleMute={onToggleMute}
                onTagClick={onTagClick}
                onTagActions={onTagActions}
                onShowAllTags={onShowAllTags}
                onShare={onShare}
                onRelated={onRelated}
              />
            </div>
          ))}
          <div ref={sentinelRef} className="h-2 w-full" />
        </div>
      </main>

      {/* Header */}
      <header className="safe-t pointer-events-none absolute inset-x-0 top-0 z-30">
        <div className="pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent px-3 pb-3 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onHomeClick}
              aria-label="danfeed — back to the default feed"
              title="Back to the default feed"
              className="-ml-1 flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-bold tracking-tight transition hover:bg-white/10 active:scale-95"
            >
              <img
                src={logoMark}
                alt=""
                width={28}
                height={28}
                draggable={false}
                decoding="async"
                className="h-7 w-7 rounded-full bg-white/10 object-cover select-none"
              />
              {/* The wordmark only appears where there is room for it: on a phone it
                  would squeeze the search box below its placeholder. */}
              <span className="hidden sm:inline">danfeed</span>
            </button>

            <TagSearch
              value={queryInput}
              onChange={setQueryInput}
              recents={recents}
              onClearRecents={onClearRecents}
              focusSignal={focusSignal}
            />

            <button
              type="button"
              onClick={onAddClick}
              aria-label="Add a URL"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black"
            >
              <IconPlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onSavedClick}
              aria-label="Saved"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <IconBookmark className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onSettingsClick}
              aria-label={
                nsfw ? 'Settings — unfiltered content is on' : 'Settings'
              }
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <IconGear className="h-4 w-4" />
              {nsfw && (
                <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-black bg-amber-400" />
              )}
            </button>
            {/* Only where a keyboard can be assumed: on a phone the icon would be a mystery
                and the width is already spoken for. */}
            <button
              type="button"
              onClick={onShowShortcuts}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white sm:flex"
            >
              <IconKeyboard className="h-4 w-4" />
            </button>
          </div>

          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
            {CHIPS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setChip(option.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                  chip === option.id
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white/75 hover:bg-white/15'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* First-load spinner */}
      {loading && items.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-5">
          <div className="flex flex-col items-center gap-2">
            <img
              src={logoMark}
              alt=""
              width={64}
              height={64}
              draggable={false}
              decoding="async"
              className="h-16 w-16 rounded-full opacity-90 select-none"
            />
            <p className="text-lg font-bold tracking-tight text-white/90">danfeed</p>
          </div>
          <div className="df-spin h-7 w-7 rounded-full border-2 border-white/25 border-t-white" />
        </div>
      )}

      {/* Too many tags: the request was never sent. */}
      {tagLimit && (
        <TagLimitNotice
          tokens={tagLimit.tokens}
          filterTokens={tagLimit.filterTokens}
          limit={tagLimit.limit}
          onRemove={onRemoveTag}
          onClear={onClearSearch}
        />
      )}

      {/* Hard failure: nothing to show yet */}
      {items.length === 0 && error && (
        <div className="absolute inset-0 z-40 bg-black">
          <Diagnostic error={error} onRetry={onRetry} />
        </div>
      )}

      {/* Soft failure: keep what we have, offer a retry */}
      {items.length > 0 && error && (
        <div className="safe-b absolute inset-x-3 bottom-16 z-40" role="status">
          <div className="df-fade-up flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/15 p-3 backdrop-blur-md">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <p className="flex-1 text-xs leading-relaxed text-amber-100">{error.message}</p>
            <button
              type="button"
              onClick={onLoadMore}
              className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Empty */}
      {empty && !error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-8">
          <div className="text-center">
            <p className="text-sm text-white/70">
              {hasMore ? 'Nothing here yet.' : "You're all caught up."}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {hasMore
                ? 'Try a different tag or filter.'
                : 'Clear your history to see these posts again.'}
            </p>
            {!hasMore && (
              <button
                type="button"
                onClick={onClearHistory}
                className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                Reset feed history
              </button>
            )}
          </div>
        </div>
      )}

      {/* End-of-feed marker */}
      {!hasMore && items.length > 0 && !loading && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 text-center text-[10px] uppercase tracking-widest text-white/30">
          end of feed
        </div>
      )}
    </div>
  )
}
