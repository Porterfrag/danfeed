import type { MediaItem } from '../types'
import { tagLabel } from '../lib/danbooru'
import { categoriesOf } from '../lib/tagCategories'
import { useLongPress } from '../lib/useLongPress'
import { Sheet } from './Sheet'
import type { TagTarget } from './TagActionsSheet'
import { IconChevronRight } from './icons'

interface Props {
  /** The post whose tags are showing, or null when the sheet is closed. */
  item: MediaItem | null
  onClose: () => void
  /** Search one tag, whichever category it belongs to. */
  onPick: (tag: string) => void
  /** Open the actions sheet for one tag: the same hold the slide chips answer to. */
  onActions: (target: TagTarget) => void
}

/** Danbooru's `copyright` family is a series to anyone reading a row. */
const KIND: Record<string, TagTarget['kind']> = {
  artist: 'artist',
  character: 'character',
  copyright: 'series',
}

/**
 * One tag in the list. Tap searches, hold offers the rest — the same two gestures the chips on
 * a slide have, because this sheet is where the tags that did not fit are, and so where the
 * second action is wanted most.
 */
function TagRow({
  tag,
  kind,
  onPick,
  onActions,
}: {
  tag: string
  kind: TagTarget['kind']
  onPick: (tag: string) => void
  onActions: (target: TagTarget) => void
}) {
  const { holding, handlers } = useLongPress(() => onActions({ tag, kind }))

  return (
    <button
      type="button"
      {...handlers}
      onClick={(e) => {
        handlers.onClick(e)
        if (e.defaultPrevented) return
        onPick(tag)
      }}
      aria-label={`Search ${tagLabel(tag)}`}
      aria-haspopup="dialog"
      title="Hold or right-click for tag actions"
      className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-2.5 text-left transition active:bg-white/15 ${
        holding ? 'bg-white/15' : 'hover:bg-white/10'
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-sm text-white/90">{tagLabel(tag)}</span>
      <IconChevronRight className="h-4 w-4 shrink-0 text-white/30" />
    </button>
  )
}

/**
 * Every tag on a post, reachable in one place.
 *
 * The slide row can only afford a handful of chips, and the median post carries 27 general
 * tags plus a few meta ones, so without this most of a post's tags are unreachable. Rows are
 * full width and 44px tall, which is also the comfortable alternative to tapping an 11px pill
 * on a slide.
 *
 * Tags are shown with underscores read as spaces but searched in their canonical underscored
 * form — the same label/value split the autocomplete follows.
 */
export function TagsSheet({ item, onClose, onPick, onActions }: Props) {
  const groups = item ? categoriesOf(item) : []
  const total = groups.reduce((sum, group) => sum + group.tags.length, 0)

  return (
    <Sheet
      open={!!item}
      title={item?.postId ? `Tags · #${item.postId}` : 'Tags'}
      onClose={onClose}
    >
      {groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/40">This post has no tags.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                <span className={`h-2 w-2 rounded-full ${group.dot}`} aria-hidden />
                {group.label}
                <span className="font-normal tabular-nums text-white/30">{group.tags.length}</span>
              </h3>
              <ul>
                {group.tags.map((tag) => (
                  <li key={tag}>
                    <TagRow
                      tag={tag}
                      kind={KIND[group.key] ?? null}
                      onPick={onPick}
                      onActions={onActions}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/35">
            {total} tags on this post. Meta tags are flags rather than content — searching
            highres returns most of the site — so the slide row leaves them out.
          </p>
        </div>
      )}
    </Sheet>
  )
}
