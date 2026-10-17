import { useEffect, useState } from 'react'
import { announce } from '../lib/announce'
import { copyText } from '../lib/clipboard'
import { tagLabel } from '../lib/danbooru'
import { searchLink, tagPostsLink, wikiLink } from '../lib/links'
import { Sheet } from './Sheet'
import { SheetRow } from './SheetRow'

/** Which family a tag came from. Used for the wording, and for nothing else. */
export type TagKind = 'artist' | 'character' | 'series' | null

export interface TagTarget {
  /** The canonical tag: what gets searched and what the external links are built from. */
  tag: string
  kind: TagKind
}

const ABOUT: Record<Exclude<TagKind, null>, string> = {
  artist: 'About the artist',
  character: 'About the character',
  series: 'About the series',
}

interface Props {
  target: TagTarget | null
  onClose: () => void
  onSearch: (tag: string) => void
}

/**
 * Everything about one tag that is not "search it".
 *
 * The chip's tap already means search, so this holds what a search cannot say: who the artist is
 * (Danbooru's wiki), the tag's own gallery with its post count and comments, and a link that can
 * be pasted somewhere else. Reached by holding a chip or right-clicking it, never by a tap, so
 * the one-tap search keeps working exactly as it did.
 */
export function TagActionsSheet({ target, onClose, onSearch }: Props) {
  const [status, setStatus] = useState<{ id: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 1600)
    return () => clearTimeout(timer)
  }, [status])

  if (!target) return null

  const label = tagLabel(target.tag)
  const search = searchLink(target.tag)
  const about = `${target.kind ? ABOUT[target.kind] : 'About the tag'} ${label}`

  async function copy() {
    const ok = await copyText(search)
    setStatus({ id: 'copy', ok })
    announce(ok ? 'Search link copied' : 'Could not copy the link')
  }

  return (
    <Sheet open={!!target} title={`#${label}`} onClose={onClose}>
      <div className="flex flex-col gap-1">
        <SheetRow
          id="search"
          label={`Search danfeed for ${label}`}
          sub="Everything with this tag, in this feed"
          status={status}
          onClick={() => onSearch(target.tag)}
        />
        <SheetRow
          label={`Open ${label} on Danbooru`}
          sub="The tag's own gallery, with post counts and comments"
          href={tagPostsLink(target.tag)}
          onClick={onClose}
        />
        <SheetRow
          label={about}
          sub="Danbooru's wiki page for this tag"
          href={wikiLink(target.tag)}
          onClick={onClose}
        />
        <SheetRow
          id="copy"
          label="Copy link to this search"
          sub={search}
          status={status}
          onClick={() => void copy()}
        />
      </div>

      <p className="mt-3 px-3 text-[11px] leading-relaxed text-white/40">
        Post counts, comments and the wiki itself live on Danbooru. danfeed only searches.
      </p>
    </Sheet>
  )
}
