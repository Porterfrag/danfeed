import { tagLabel } from '../lib/danbooru'
import { useLongPress } from '../lib/useLongPress'
import type { TagTarget } from './TagActionsSheet'

interface Props {
  /** The canonical tag: what gets searched. */
  tag: string
  /** Set for artists, characters and series, so the actions sheet can word itself correctly. */
  kind: TagTarget['kind']
  /** The family's aria prefix, e.g. "Show more by artist"; the label is appended. */
  ariaPrefix: string
  /** The category dot, on entity chips only. */
  dot?: string
  variant: 'entity' | 'general'
  onTagClick: (tag: string) => void
  onTagActions: (target: TagTarget) => void
}

/**
 * Two looks, one behaviour.
 *
 * Entity chips are the gallery label under the artwork: the artist first and brightest, then the
 * character, then the series, each smaller or dimmer than the one before. They keep no pill of
 * their own, so the frame stays the picture's and the order alone says what the post is.
 *
 * General tags are the film's edge printing: mono, small, square-cornered and quiet, because
 * `blue_dress` is a code rather than a name. The row is one line either way.
 */
const LABEL: Record<string, string> = {
  artist: 'text-sm font-semibold text-white',
  character: 'text-sm text-white/85',
  series: 'text-xs text-white/60',
}

export function TagChip({ tag, kind, ariaPrefix, dot, variant, onTagClick, onTagActions }: Props) {
  const { holding, handlers } = useLongPress(() => onTagActions({ tag, kind }))
  const label = tagLabel(tag)

  if (variant === 'general') {
    return (
      <button
        type="button"
        {...handlers}
        onClick={(e) => {
          handlers.onClick(e)
          // The hold already opened the sheet; searching on top of it would be a request
          // nobody asked for.
          if (e.defaultPrevented) return
          onTagClick(tag)
        }}
        aria-label={`${ariaPrefix} ${label}`}
        aria-haspopup="dialog"
        title="Hold or right-click for tag actions"
        className={`relative rounded-[5px] px-2 py-1 font-mono text-2xs ring-1 ring-inset transition before:absolute before:-inset-1 before:content-[''] active:scale-95 ${
          holding
            ? 'scale-95 bg-white/15 text-white/90 ring-white/30'
            : 'bg-white/[0.07] text-white/70 ring-white/10 hover:bg-white/15 hover:text-white/90'
        }`}
      >
        #{tag}
      </button>
    )
  }

  return (
    <button
      type="button"
      {...handlers}
      onClick={(e) => {
        handlers.onClick(e)
        if (e.defaultPrevented) return
        onTagClick(tag)
      }}
      aria-label={`${ariaPrefix} ${label}`}
      aria-haspopup="dialog"
      title="Hold or right-click for tag actions"
      className={`relative -mx-1 flex max-w-full items-center gap-1.5 rounded-lg px-1 py-0.5 transition before:absolute before:-inset-1 before:content-[''] ${
        LABEL[kind ?? 'artist']
      } ${holding ? 'bg-white/15' : 'hover:bg-white/10 active:opacity-70'}`}
    >
      {dot && <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />}
      <span className="truncate">{label}</span>
    </button>
  )
}
