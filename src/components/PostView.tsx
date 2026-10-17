import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MediaItem } from '../types'
import { tagLabel } from '../lib/danbooru'
import { useZoom } from '../lib/useZoom'
import {
  IconArtist,
  IconBookmark,
  IconChevronRight,
  IconExternal,
  IconPlay,
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
  onSave: (item: MediaItem) => void
  onToggleMute: () => void
  /** Browse everything by one artist tag. */
  onArtistClick: (tag: string) => void
}

/** Collaborations are rare; beyond a few chips the row would swallow the slide. */
const MAX_ARTIST_CHIPS = 3
const MAX_TAG_CHIPS = 5

const RATING_LABEL: Record<string, string> = {
  g: 'General',
  s: 'Sensitive',
  q: 'Questionable',
  e: 'Explicit',
}

const RATING_STYLE: Record<string, string> = {
  g: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
  s: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  q: 'bg-orange-500/15 text-orange-300 ring-orange-400/30',
  e: 'bg-rose-500/15 text-rose-300 ring-rose-400/30',
}

function formatBytes(bytes?: number) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

export function PostView({
  item,
  index,
  active,
  distance,
  saved,
  muted,
  maxBytes,
  onSave,
  onToggleMute,
  onArtistClick,
}: Props) {
  const isVideo = item.kind === 'video' || item.kind === 'ugoira'
  const isEmbed = item.kind === 'embed'
  const isImage = item.kind === 'photo' || item.kind === 'gif'

  const [failed, setFailed] = useState(false)
  const [forced, setForced] = useState(false)
  const [paused, setPaused] = useState(true)
  const [progress, setProgress] = useState(0)

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
    if (active && !gated) {
      void video.play().catch(() => setPaused(true))
    } else {
      video.pause()
    }
  }, [active, gated, item.key])

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

  // `tag_string` already contains the artist tags, so the generic chip row would
  // show them a second time. They get their own affordance instead.
  const artistTags = useMemo(() => new Set(item.artists), [item.artists])
  const otherTags = useMemo(
    () => item.tags.filter((tag) => !artistTags.has(tag)),
    [item.tags, artistTags],
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Ambient backdrop so portrait/landscape media never sits on flat black. */}
      {item.poster && (
        <img
          src={item.poster}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
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
            src={item.src}
            poster={item.poster}
            loop
            muted={muted}
            playsInline
            preload={distance <= 1 ? 'auto' : 'none'}
            className="h-full w-full select-none object-contain"
            onError={() => setFailed(true)}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onTimeUpdate={(e) => {
              const video = e.currentTarget
              if (video.duration > 0) setProgress(video.currentTime / video.duration)
            }}
          />
        ) : (
          <img
            src={item.src}
            alt={item.tags.slice(0, 3).join(', ')}
            draggable={false}
            loading={distance <= 3 ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => setFailed(true)}
            className="max-h-full max-w-full select-none object-contain"
            style={{
              transform: `translate3d(${zoom.state.x}px, ${zoom.state.y}px, 0) scale(${zoom.state.s})`,
              transition: zoom.dragging ? 'none' : 'transform 180ms ease-out',
            }}
          />
        )}
      </div>

      {/* Paused affordance */}
      {isVideo && paused && !failed && !gated && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-full bg-black/45 p-4 backdrop-blur-sm">
            <IconPlay className="h-8 w-8 text-white/90" />
          </div>
        </div>
      )}

      {/* Scrims */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-64 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-black/70 to-transparent" />

      {/* Meta */}
      <div className="absolute bottom-8 left-3 z-20 max-w-[calc(100%-5rem)]">
        {/* Artist attribution. Tapping it searches the exact artist tag, which is how
            the whole feed becomes "more from this artist". */}
        {item.artists.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {item.artists.slice(0, MAX_ARTIST_CHIPS).map((artist) => (
              <button
                key={artist}
                type="button"
                onClick={() => onArtistClick(artist)}
                aria-label={`Show more by ${tagLabel(artist)}`}
                className="flex max-w-full items-center gap-1.5 rounded-full bg-white/15 py-1 pl-1.5 pr-1.5 ring-1 ring-inset ring-white/25 backdrop-blur-md transition hover:bg-white/25 active:scale-95"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-400 text-black">
                  <IconArtist className="h-3 w-3" />
                </span>
                <span className="truncate text-[12px] font-semibold text-white">
                  {tagLabel(artist)}
                </span>
                <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-white/50" />
              </button>
            ))}
            {item.artists.length > MAX_ARTIST_CHIPS && (
              <span className="px-1 text-[11px] text-white/50">
                +{item.artists.length - MAX_ARTIST_CHIPS}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {otherTags.slice(0, MAX_TAG_CHIPS).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/85 backdrop-blur-sm"
            >
              #{tag}
            </span>
          ))}
          {otherTags.length > MAX_TAG_CHIPS && (
            <span className="px-1 py-0.5 text-[11px] text-white/50">
              +{otherTags.length - MAX_TAG_CHIPS}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/60">
          {typeof item.score === 'number' && <span>♥ {item.score}</span>}
          {rating && RATING_LABEL[rating] && (
            <span
              className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${
                RATING_STYLE[rating] ?? 'bg-white/10 text-white/70 ring-white/20'
              }`}
            >
              {RATING_LABEL[rating]}
            </span>
          )}
          {item.postId && <span className="tabular-nums">#{item.postId}</span>}
          {item.origin === 'custom' && <span className="text-white/40">custom</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="absolute bottom-8 right-2 z-20 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => onSave(item)}
          aria-label={saved ? 'Remove from saved' : 'Save'}
          aria-pressed={saved}
          className={`flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-md transition ${
            saved ? 'bg-white text-black' : 'bg-black/40 text-white'
          }`}
        >
          <IconBookmark filled={saved} />
        </button>

        {isVideo && (
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md"
          >
            {muted ? <IconVolumeOff /> : <IconVolumeOn />}
          </button>
        )}

        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md"
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
