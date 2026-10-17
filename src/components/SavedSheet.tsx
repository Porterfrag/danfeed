import type { MediaItem } from '../types'
import { Sheet } from './Sheet'
import { IconBookmark, IconPlay, IconTrash } from './icons'

interface Props {
  open: boolean
  onClose: () => void
  items: MediaItem[]
  onPlay: (item: MediaItem) => void
  onRemove: (key: string) => void
}

const KIND_LABEL: Record<string, string> = {
  photo: 'photo',
  video: 'video',
  gif: 'gif',
  ugoira: 'ugoira',
  embed: 'embed',
}

export function SavedSheet({ open, onClose, items, onPlay, onRemove }: Props) {
  return (
    <Sheet open={open} title={`Saved · ${items.length}`} onClose={onClose}>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <IconBookmark className="h-7 w-7 text-white/25" />
          <p className="text-sm text-white/60">Nothing saved yet.</p>
          <p className="max-w-xs text-xs text-white/35">
            Tap the bookmark on any post, or double-tap a video.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-3 rounded-xl bg-white/5 p-2 hover:bg-white/10"
            >
              <button
                type="button"
                onClick={() => onPlay(item)}
                className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black"
                aria-label="Play"
              >
                {item.poster ? (
                  <img src={item.poster} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-white/40">
                    <IconPlay className="h-5 w-5" />
                  </span>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-white/80">
                  {item.tags.slice(0, 4).map((tag) => `#${tag}`).join(' ') || item.title || 'Untitled'}
                </p>
                <p className="mt-0.5 text-2xs text-white/35">
                  {KIND_LABEL[item.kind] ?? item.kind}
                  {item.postId ? ` · #${item.postId}` : ''}
                  {item.origin === 'custom' ? ' · custom' : ''}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onPlay(item)}
                aria-label="Play"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <IconPlay className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => onRemove(item.key)}
                aria-label="Remove"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
