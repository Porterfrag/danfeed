import { tagLabel } from '../lib/danbooru'
import { useLongPress } from '../lib/useLongPress'
import { IconChevronRight } from './icons'
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
 * Two looks, one behaviour. Entity chips carry the dot and the chevron because they are who or
 * what the post is; general tags stay quieter because they are descriptors.
 */
const VARIANT = {
  entity:
    'flex max-w-full items-center gap-1.5 rounded-full bg-white/15 py-1 pl-2 pr-1.5 ring-1 ring-inset ring-white/25 backdrop-blur-md transition hover:bg-white/25 active:scale-95',
  general:
    "relative rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85 ring-1 ring-inset ring-white/15 backdrop-blur-md transition before:absolute before:-inset-1 before:content-[''] hover:bg-white/20 active:scale-95",
} as const

/**
 * A tag on a slide: tap to search it, hold for the rest.
 *
 * A component rather than markup in a loop because the hold is stateful — a hook per chip is
 * the only place that can live, and hooks cannot be called from a `.map` callback.
 */
export function TagChip({ tag, kind, ariaPrefix, dot, variant, onTagClick, onTagActions }: Props) {
  const { holding, handlers } = useLongPress(() => onTagActions({ tag, kind }))
  const label = tagLabel(tag)

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
      className={`${VARIANT[variant]}${holding ? ' scale-95 bg-white/25 ring-white/50' : ''}`}
    >
      {dot && <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />}
      {variant === 'entity' ? (
        <>
          <span className="truncate text-[12px] font-semibold text-white">{label}</span>
          <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-white/50" />
        </>
      ) : (
        `#${tag}`
      )}
    </button>
  )
}
