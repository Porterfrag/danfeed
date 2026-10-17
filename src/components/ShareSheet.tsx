import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'
import { copyText } from '../lib/clipboard'
import { Sheet } from './Sheet'

interface Props {
  open: boolean
  /** The post being shared. */
  item: MediaItem | null
  /** The current search box text, offered as a link into the same feed. */
  query: string
  onClose: () => void
}

/** The post's own page: the canonical home of a Danbooru post, artist credit and all. */
function postLink(item: MediaItem) {
  return item.postId ? `https://danbooru.donmai.us/posts/${item.postId}` : ''
}

/**
 * A link back into danfeed with this search in the box.
 *
 * Built from the current origin rather than a hard-coded host so it works from localhost during
 * development and from the deployment in public. The rating is deliberately left out: which
 * ratings the recipient sees is their setting to make, not the sender's.
 */
function searchLink(query: string) {
  const url = new URL('/', location.href)
  url.searchParams.set('q', query.trim())
  return url.toString()
}

interface RowProps {
  id: string
  label: string
  sub: string
  status: { id: string; ok: boolean } | null
  onClick: () => void
}

function Row({ id, label, sub, status, onClick }: RowProps) {
  const result = status?.id === id ? (status.ok ? 'Copied' : 'Could not copy') : null

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/8"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-white">{result ?? label}</span>
        <span className="block truncate text-[11px] text-white/40">{sub}</span>
      </span>
    </button>
  )
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
  }

  return (
    <Sheet open={open} title="Share" onClose={onClose}>
      <div className="flex flex-col gap-1">
        {post && (
          <Row
            id="post"
            label="Copy link to this post"
            sub={post}
            status={result}
            onClick={() => void copy('post', post)}
          />
        )}
        <Row
          id="media"
          label="Copy media link"
          sub={media}
          status={result}
          onClick={() => void copy('media', media)}
        />
        {search && (
          <Row
            id="search"
            label="Copy link to this search"
            sub={search}
            status={result}
            onClick={() => void copy('search', search)}
          />
        )}
        {nativeShare && (
          <Row
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

      <p className="mt-3 px-3 text-[11px] leading-relaxed text-white/40">
        Post links open on Danbooru, where the artist&apos;s credit lives. A danfeed search link
        opens with whatever content rating the person opening it chose for themselves.
      </p>
    </Sheet>
  )
}
