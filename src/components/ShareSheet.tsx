import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'
import { announce } from '../lib/announce'
import { copyText } from '../lib/clipboard'
import { postLink, searchLink } from '../lib/links'
import { Sheet } from './Sheet'
import { SheetRow } from './SheetRow'

interface Props {
  open: boolean
  /** The post being shared. */
  item: MediaItem | null
  /** The current search box text, offered as a link into the same feed. */
  query: string
  onClose: () => void
}

export function ShareSheet({ open, item, query, onClose }: Props) {
  /**
   * Which row was just copied, and on which post.
   *
   * The post is part of the key so the feedback cannot leak from one slide to the next: opening
   * the sheet on a new post simply finds no entry for it, with no reset to remember.
   */
  const [status, setStatus] = useState<{ key: string; id: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 1600)
    return () => clearTimeout(timer)
  }, [status])

  if (!item) return null

  // Read off once: `item` is a destructured parameter, and TypeScript drops the null check
  // inside the callbacks below for bindings that could be reassigned.
  const key = item.key
  const media = item.src
  const post = postLink(item)
  const search = query.trim() ? searchLink(query) : ''
  const nativeShare = typeof navigator.share === 'function'

  const result = status?.key === key ? { id: status.id, ok: status.ok } : null

  async function copy(id: string, text: string) {
    const ok = await copyText(text)
    setStatus({ key, id, ok })
    // The row says "Copied", but focus may already have moved on; a listener gets told.
    announce(ok ? 'Link copied' : 'Could not copy the link')
  }

  return (
    <Sheet open={open} title="Share" onClose={onClose}>
      <div className="flex flex-col gap-1">
        {post && (
          <SheetRow
            id="post"
            label="Copy link to this post"
            sub={post}
            status={result}
            onClick={() => void copy('post', post)}
          />
        )}
        <SheetRow
          id="media"
          label="Copy media link"
          sub={media}
          status={result}
          onClick={() => void copy('media', media)}
        />
        {search && (
          <SheetRow
            id="search"
            label="Copy link to this search"
            sub={search}
            status={result}
            onClick={() => void copy('search', search)}
          />
        )}
        {nativeShare && (
          <SheetRow
            id="native"
            label="Share…"
            sub="Open your device's own share sheet"
            status={result}
            onClick={() => {
              onClose()
              void navigator.share({ title: 'danfeed', url: post || media }).catch(() => undefined)
            }}
          />
        )}
      </div>

      <p className="mt-3 px-3 text-2xs leading-relaxed text-white/40">
        Post links open on Danbooru, where the artist&apos;s credit lives. A danfeed search link
        opens with whatever content rating the person opening it chose for themselves.
      </p>
    </Sheet>
  )
}
