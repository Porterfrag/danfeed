import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../types'
import type { BooruError } from '../lib/danbooru'
import { CHIPS } from '../hooks/useFeed'
import type { ChipId } from '../hooks/useFeed'
import { PostView } from './PostView'
import { TagSearch } from './TagSearch'
import { TagLimitNotice } from './TagLimitNotice'
import { Diagnostic } from './Diagnostic'
import { IconAlert, IconBookmark, IconGear, IconPlus } from './icons'
import type { TagLimitState } from '../hooks/useFeed'

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
}

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
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

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
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { root, rootMargin: '800px 0px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [onLoadMore, items.length])

  useEffect(() => {
    if (scrollToTopSignal === 0) return
    scrollerRef.current?.scrollTo({ top: 0 })
    setActive(0)
  }, [scrollToTopSignal])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const root = scrollerRef.current
      if (!root) return

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        root.scrollBy({ top: root.clientHeight, behavior: 'smooth' })
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        root.scrollBy({ top: -root.clientHeight, behavior: 'smooth' })
      } else if (e.key === ' ') {
        e.preventDefault()
        const video = root.querySelector<HTMLVideoElement>(
          `[data-slide][data-index="${active}"] video`,
        )
        if (video) {
          if (video.paused) void video.play().catch(() => undefined)
          else video.pause()
        }
      } else if (e.key === 'm' || e.key === 'M') {
        onToggleMute()
      } else if (e.key === 's' || e.key === 'S') {
        const item = items[active]
        if (item) onSave(item)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, items, onSave, onToggleMute])

  const empty = !loading && items.length === 0 && !tagLimit

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <div
        ref={scrollerRef}
        className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain"
      >
        {items.map((item, index) => (
          <div
            key={item.key}
            data-slide
            data-index={index}
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
            />
          </div>
        ))}
        <div ref={sentinelRef} className="h-2 w-full" />
      </div>

      {/* Header */}
      <div className="safe-t pointer-events-none absolute inset-x-0 top-0 z-30">
        <div className="pointer-events-auto bg-gradient-to-b from-black/80 via-black/40 to-transparent px-3 pb-3 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onHomeClick}
              aria-label="danfeed — back to the default feed"
              title="Back to the default feed"
              className="-ml-1 shrink-0 rounded-lg px-1.5 py-1 text-sm font-bold tracking-tight transition hover:bg-white/10 active:scale-95"
            >
              danfeed
            </button>

            <TagSearch value={queryInput} onChange={setQueryInput} />

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
              aria-label="Settings"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <IconGear className="h-4 w-4" />
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
      </div>

      {/* First-load spinner */}
      {loading && items.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
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
        <div className="safe-b absolute inset-x-3 bottom-16 z-40">
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
