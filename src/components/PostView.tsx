import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MediaItem } from '../types'
import { TAG_CATEGORY } from '../lib/tagCategories'
import type { TagCategoryKey } from '../lib/tagCategories'
import { useReducedMotion } from '../lib/useReducedMotion'
import { useZoom } from '../lib/useZoom'
import { tagLabel } from '../lib/danbooru'
import { relatedSubject } from '../lib/related'
import { TagChip } from './TagChip'
import type { TagTarget } from './TagActionsSheet'
import {
  IconBookmark,
  IconChevronRight,
  IconCompass,
  IconExternal,
  IconPlay,
  IconShare,
  IconVolumeOff,
  IconVolumeOn,
} from './icons'

interface Props {
  item: MediaItem
  index: number
  active: boolean
  distance: number
  saved: boolean
  muted: boolean
  maxBytes: number
  /**
   * True once the chrome has been left alone for a while. The label and the rail step back to a
   * quarter — never away: which tags a post carries is the point of the app, so it waits rather
   * than hides, and any touch brings it back.
   */
  quiet: boolean
  onSave: (item: MediaItem) => void
  onToggleMute: () => void
  /** Search one tag, whichever category it belongs to. */
  onTagClick: (tag: string) => void
  /** Open the actions sheet for one tag: what a long press or a right-click on a chip asks for. */
  onTagActions: (target: TagTarget) => void
  /** Open the full tag list for this post. */
  onShowAllTags: (item: MediaItem) => void
  /** Open the share sheet for this post. */
  onShare: (item: MediaItem) => void
  /** Look for what Danbooru considers related to the tag this post is known by. */
  onRelated: (target: TagTarget) => void
}

/**
 * How many chips each family gets in the slide row before "+N" takes over.
 *
 * Capped per category rather than for the row as a whole. Group pictures routinely carry
 * several characters, and a single shared cap would push the series off the slide entirely,
 * which is the tag most likely to identify the work.
 *
 * Meta is zero on purpose: `highres` alone covers 8.3M posts and `bad_id` means the post's ID
 * is wrong, so they are flags rather than things worth browsing. They stay reachable in the
 * all-tags sheet.
 */
const ROW_CAPS: Record<TagCategoryKey, number> = {
  artist: 2,
  character: 2,
  copyright: 1,
  general: 5,
  meta: 0,
}

/** The families that get a dot and a chevron in the row above the general tags. */
const ROW_ENTITY_KEYS: TagCategoryKey[] = ['artist', 'character', 'copyright']

/** Danbooru's `copyright` family is a series to anyone reading a slide. */
const ENTITY_KIND: Record<string, TagTarget['kind']> = {
  artist: 'artist',
  character: 'character',
  copyright: 'series',
}

/**
 * The "+N" standing in for the tags a row is not showing. Tapping it opens the full list, which
 * is the only way to reach them: the median post carries 27 general tags and the row shows five.
 */
function MoreTags({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show all tags"
      className="relative flex shrink-0 items-center gap-0.5 rounded-[5px] bg-white/[0.07] px-1.5 py-1 font-mono text-2xs text-white/55 ring-1 ring-inset ring-white/10 transition before:absolute before:-inset-1 before:content-[''] hover:bg-white/15 hover:text-white/90 active:scale-95"
    >
      +{count}
      <IconChevronRight className="h-3.5 w-3.5 shrink-0" />
    </button>
  )
}

const RATING_LABEL: Record<string, string> = {
  g: 'General',
  s: 'Sensitive',
  q: 'Questionable',
  e: 'Explicit',
}

const RATING_STYLE: Record<string, string> = {
  g: 'bg-emerald-400/10 text-emerald-300/90 ring-emerald-300/25',
  s: 'bg-amber-400/10 text-amber-300/90 ring-amber-300/25',
  q: 'bg-orange-400/10 text-orange-300/90 ring-orange-300/25',
  e: 'bg-rose-400/10 text-rose-300/90 ring-rose-300/25',
}

/**
 * The rail: 44px targets, thin strokes, no glass.
 *
 * The scrim under the artwork already darkens the corner they sit in, so the buttons only have to
 * stay visible on a bright picture — a soft black disc does that without the blur pass that
 * `backdrop-filter` costs on the phones this is built for.
 *
 * The disc colour is applied per button rather than in the shared part: the saved button has to be
 * able to turn white, and two background utilities on one element would leave the winner up to the
 * order Tailwind happens to emit them in.
 */
const RAIL_BASE =
  'flex h-11 w-11 items-center justify-center rounded-full ring-1 ring-white/10 transition active:scale-90'
const RAIL = `${RAIL_BASE} bg-black/35 text-white`

function formatBytes(bytes?: number) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/**
 * The same media URL with a retry marker on it.
 *
 * Asking the element for the URL that just failed can be answered out of the cache that already
 * held the failure, so the retry changes the query instead. The CDN ignores parameters it does
 * not know, and the browser treats it as a request it has never seen.
 */
function retryUrl(url: string, attempt: number) {
  try {
    const next = new URL(url)
    next.searchParams.set('df-retry', String(attempt))
    return next.toString()
  } catch {
    return url
  }
}

export function PostView({
  item,
  index,
  active,
  distance,
  saved,
  muted,
  maxBytes,
  quiet,
  onSave,
  onToggleMute,
  onTagClick,
  onTagActions,
  onShowAllTags,
  onShare,
  onRelated,
}: Props) {
  const isVideo = item.kind === 'video' || item.kind === 'ugoira'
  const isEmbed = item.kind === 'embed'
  const isImage = item.kind === 'photo' || item.kind === 'gif'

  // The artist who made it, else the character, else the series — the one tag "more like this"
  // can actually be about. Null on a post that carries none of the three, and then there is no
  // button: a general tag describes the picture rather than a body of work to explore.
  const subject = relatedSubject(item)

  const [failed, setFailed] = useState(false)
  const [forced, setForced] = useState(false)
  const [paused, setPaused] = useState(true)
  const [progress, setProgress] = useState(0)
  /** Bumped to point the element at a fresh URL. See `retryUrl`. */
  const [attempt, setAttempt] = useState(0)
  /** The bookmark's one-shot settle. */
  const [pop, setPop] = useState(false)
  const firstSave = useRef(true)
  const retried = useRef(false)
  const retryTimer = useRef<number | null>(null)
  const reduced = useReducedMotion()

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const zoom = useZoom(stageRef)

  const down = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastTap = useRef(0)
  const tapTimer = useRef<number | null>(null)

  // Big videos are opt-in so a swipe does not silently burn mobile data.
  const gated =
    item.kind === 'video' && maxBytes > 0 && typeof item.bytes === 'number' && item.bytes > maxBytes
      ? !forced
      : false

  // The slide is keyed by `item.key` in <Feed>, so PostView remounts on a new post
  // and all local state starts fresh — no reset effect needed.

  // React does not always apply `muted` on first paint; set it imperatively too.
  useEffect(() => {
    const video = videoRef.current
    if (video) video.muted = muted
  }, [muted, gated, item.key])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // Nothing starts on its own when less motion has been asked for: a video playing itself is
    // what that setting is about. The play overlay stays one tap away.
    if (active && !gated && !reduced) {
      void video.play().catch(() => setPaused(true))
    } else {
      video.pause()
    }
  }, [active, gated, item.key, reduced])

  /**
   * One quiet retry, then the error card.
   *
   * The media CDN answers 5xx when it is shedding load, and browsers keep the failure: a retry
   * on the same URL can be served straight out of the cache that recorded it. Waiting a moment
   * and asking on a URL the browser has never seen is what actually gets a second answer.
   */
  const handleMediaError = useCallback(() => {
    if (retried.current) {
      setFailed(true)
      return
    }
    retried.current = true
    retryTimer.current = window.setTimeout(() => setAttempt((n) => n + 1), 800)
  }, [])

  /** The card's own button: a fresh URL, and the retry budget back. */
  const retryMedia = useCallback(() => {
    retried.current = false
    setFailed(false)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(
    () => () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current)
    },
    [],
  )

  const mediaSrc = attempt > 0 ? retryUrl(item.src, attempt) : item.src

  /**
   * Which URL has finished loading, by identity rather than a boolean.
   *
   * The fade is on exactly while the URL in the element has not loaded yet, so a retry (a new URL)
   * starts over from the preview without an effect resetting anything.
   */
  const [readySrc, setReadySrc] = useState<string | null>(null)
  const ready = readySrc === mediaSrc

  // The bookmark settles when it is filled, not when an already-saved post scrolls back into view.
  useEffect(() => {
    if (!saved) return
    if (firstSave.current) {
      firstSave.current = false
      return
    }
    setPop(true)
    const timer = window.setTimeout(() => setPop(false), 260)
    return () => window.clearTimeout(timer)
  }, [saved])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }, [])

  const handleTap = useCallback(
    (clientX: number, clientY: number) => {
      if (isVideo) {
        const now = Date.now()
        if (now - lastTap.current < 280) {
          // Second tap: keep the save, undo the pause from the first tap.
          lastTap.current = 0
          onSave(item)
          togglePlay()
        } else {
          lastTap.current = now
          togglePlay()
        }
        return
      }

      if (!isImage) return

      const now = Date.now()
      if (now - lastTap.current < 280) {
        if (tapTimer.current) {
          clearTimeout(tapTimer.current)
          tapTimer.current = null
        }
        lastTap.current = 0
        zoom.toggle(clientX, clientY)
        return
      }

      lastTap.current = now
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = null
        zoom.reset()
      }, 280)
    },
    [isVideo, isImage, item, onSave, togglePlay, zoom],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    down.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    if (isImage) zoom.onPointerDown(e)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isImage) zoom.onPointerMove(e)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isImage) zoom.onPointerUp(e)
    const start = down.current
    down.current = null
    if (!start) return
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (moved > 12 || Date.now() - start.t > 500) return
    handleTap(e.clientX, e.clientY)
  }

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isImage) zoom.onPointerCancel(e)
    down.current = null
  }

  const seek = (e: ReactPointerEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    video.currentTime = ratio * video.duration
    setProgress(ratio)
  }

  const rating = item.rating?.toLowerCase()

  // `tag_string` contains every category, so the general row would show artists, characters,
  // series and meta a second time. Each is subtracted out and given its own treatment.
  const { entityChips, hiddenEntityCount } = useMemo(() => {
    const chips: Array<{
      key: string
      tag: string
      kind: TagTarget['kind']
      dot: string
      aria: string
    }> = []
    let hidden = 0
    for (const key of ROW_ENTITY_KEYS) {
      const spec = TAG_CATEGORY[key]
      const tags = spec.read(item)
      const cap = ROW_CAPS[key]
      for (const tag of tags.slice(0, cap)) {
        chips.push({
          key: `${key}:${tag}`,
          tag,
          kind: ENTITY_KIND[key] ?? null,
          dot: spec.dot,
          aria: spec.aria,
        })
      }
      if (tags.length > cap) hidden += tags.length - cap
    }
    return { entityChips: chips, hiddenEntityCount: hidden }
  }, [item])

  const generalTags = useMemo(() => TAG_CATEGORY.general.read(item), [item])

  // Meta counts towards "+N" as well as hidden general tags: the row never shows meta, so it
  // always has to be counted or a post with a few general tags and some meta would have no way
  // into the sheet at all.
  const hiddenTagCount =
    Math.max(0, generalTags.length - ROW_CAPS.general) + item.metaTags.length

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* The preview, blurred: ambience for a picture that does not fit the screen, and the
          thing the media sharpens out of while it loads — brighter until it does. */}
      {item.poster && (
        <img
          src={item.poster}
          alt=""
          aria-hidden
          className={`pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-2xl transition-opacity duration-500 motion-reduce:transition-none ${
            ready ? 'opacity-25' : 'opacity-45'
          }`}
        />
      )}

      <div
        ref={stageRef}
        data-index={index}
        className="absolute inset-0 z-10 flex touch-pan-y items-center justify-center"
        style={{ touchAction: isImage && zoom.state.s > 1 ? 'none' : 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {failed ? (
          <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center">
            {item.poster && (
              <img src={item.poster} alt="" className="max-h-52 rounded-xl object-contain opacity-60" />
            )}
            <p className="text-sm text-white/70">This media could not be loaded.</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={retryMedia}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black"
              >
                Try again
              </button>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium text-white"
                >
                  Open original
                </a>
              )}
            </div>
          </div>
        ) : gated ? (
          <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center">
            {item.poster && (
              <img src={item.poster} alt="" className="max-h-52 rounded-xl object-contain opacity-70" />
            )}
            <p className="text-sm text-white/60">{formatBytes(item.bytes)} video · not loaded</p>
            <button
              type="button"
              onClick={() => setForced(true)}
              className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
            >
              Load video
            </button>
          </div>
        ) : isEmbed ? (
          <div className="relative aspect-video w-full">
            <iframe
              src={item.src}
              title={item.title ?? 'Embedded video'}
              className="absolute inset-0 h-full w-full border-0"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        ) : isVideo ? (
          <video
            ref={videoRef}
            src={mediaSrc}
            poster={item.poster}
            loop
            muted={muted}
            playsInline
            preload={distance <= 1 ? 'auto' : 'none'}
            className="h-full w-full select-none object-contain"
            onError={handleMediaError}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onTimeUpdate={(e) => {
              const video = e.currentTarget
              if (video.duration > 0) setProgress(video.currentTime / video.duration)
            }}
          />
        ) : (
          <img
            src={mediaSrc}
            alt={item.tags.slice(0, 3).join(', ')}
            draggable={false}
            loading={distance <= 3 ? 'eager' : 'lazy'}
            decoding="async"
            ref={(el) => {
              // A cached image can be complete before React's onLoad is attached.
              if (el && el.complete && el.naturalWidth > 0) setReadySrc(mediaSrc)
            }}
            onLoad={() => setReadySrc(mediaSrc)}
            onError={handleMediaError}
            className={`max-h-full max-w-full select-none object-contain transition-opacity duration-300 motion-reduce:transition-none ${
              ready ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              transform: `translate3d(${zoom.state.x}px, ${zoom.state.y}px, 0) scale(${zoom.state.s})`,
              transition: zoom.dragging || reduced ? 'none' : 'transform 180ms ease-out',
            }}
          />
        )}
      </div>

      {/* Paused affordance */}
      {isVideo && paused && !failed && !gated && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-full bg-black/50 p-4">
            <IconPlay className="h-8 w-8 text-white/90" />
          </div>
        </div>
      )}

      {/* Scrims */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-64 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/70 to-transparent" />

      {/* Meta. Steps back to a quarter when the chrome has been left alone — see `quiet` — and
          settles up when the slide comes to rest, the way a caption arrives with a picture. */}
      <div
        className={`absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] left-3 z-20 max-w-[calc(100%-5rem)] transition-opacity duration-500 motion-reduce:transition-none ${
          quiet ? 'opacity-25' : 'opacity-100'
        } ${active ? 'df-settle' : ''}`}
      >
        {/* Browsable entity tags. Tapping one searches that exact tag, so the feed
            becomes "everything else with this artist / character / series". */}
        {entityChips.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {entityChips.map((chip) => (
              <TagChip
                key={chip.key}
                tag={chip.tag}
                kind={chip.kind}
                ariaPrefix={chip.aria}
                dot={chip.dot}
                variant="entity"
                onTagClick={onTagClick}
                onTagActions={onTagActions}
              />
            ))}
            {hiddenEntityCount > 0 && (
              <MoreTags count={hiddenEntityCount} onClick={() => onShowAllTags(item)} />
            )}
          </div>
        )}

        {/* General tags. Same one-tap search as the row above, kept visually quieter because
            these are broad descriptors rather than who or what the post is.

            The pill is small, so the hit area is grown 4px on every side by a pseudo-element —
            exactly the row gap, so neighbouring targets meet without overlapping. That puts the
            target at roughly 33px, and the all-tags sheet covers the rest. */}
        <div className="flex flex-wrap gap-2">
          {generalTags.slice(0, ROW_CAPS.general).map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              kind={null}
              ariaPrefix={TAG_CATEGORY.general.aria}
              variant="general"
              onTagClick={onTagClick}
              onTagActions={onTagActions}
            />
          ))}
          {hiddenTagCount > 0 && (
            <MoreTags count={hiddenTagCount} onClick={() => onShowAllTags(item)} />
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 font-mono text-2xs text-white/55">
          {typeof item.score === 'number' && <span>♥ {item.score}</span>}
          {rating && RATING_LABEL[rating] && (
            <span
              className={`rounded-[4px] px-1.5 py-px tracking-wide ring-1 ring-inset ${
                RATING_STYLE[rating] ?? 'bg-white/5 text-white/60 ring-white/15'
              }`}
            >
              {RATING_LABEL[rating]}
            </span>
          )}
          {item.postId && <span className="tabular-nums">#{item.postId}</span>}
          {item.origin === 'custom' && <span className="text-white/35">custom</span>}
        </div>
      </div>

      {/* Actions */}
      <div
        className={`absolute bottom-[calc(2rem+env(safe-area-inset-bottom))] right-2 z-20 flex flex-col items-center gap-3 transition-opacity duration-500 motion-reduce:transition-none ${
          quiet ? 'opacity-25' : 'opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => onSave(item)}
          aria-label={saved ? 'Remove from saved' : 'Save'}
          aria-pressed={saved}
          className={`${RAIL_BASE} ${
            saved ? 'bg-white text-black ring-transparent' : 'bg-black/35 text-white'
          } ${pop ? 'df-pop' : ''}`}
        >
          <IconBookmark filled={saved} />
        </button>

        {isVideo && (
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className={RAIL}
          >
            {muted ? <IconVolumeOff /> : <IconVolumeOn />}
          </button>
        )}

        {subject && (
          <button
            type="button"
            onClick={() => onRelated(subject)}
            aria-label="More like this"
            title={`Tags that go with ${tagLabel(subject.tag)}`}
            className={RAIL}
          >
            <IconCompass />
          </button>
        )}

        <button
          type="button"
          onClick={() => onShare(item)}
          aria-label="Share"
          className={RAIL}
        >
          <IconShare />
        </button>

        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original"
            className={RAIL}
          >
            <IconExternal />
          </a>
        )}
      </div>

      {/* Seek bar */}
      {isVideo && !failed && !gated && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 h-1 cursor-pointer bg-white/20"
          onPointerDown={seek}
          onPointerMove={(e) => {
            if (e.buttons === 1) seek(e)
          }}
        >
          <div
            className="h-full bg-white/90 transition-[width] duration-100"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
