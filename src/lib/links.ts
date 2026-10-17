import type { MediaItem } from '../types'

export const DANBOORU = 'https://danbooru.donmai.us'

/** The post's own page: the canonical home of a Danbooru post, artist credit and all. */
export function postLink(item: MediaItem): string {
  return item.postId ? `${DANBOORU}/posts/${item.postId}` : ''
}

/** Every post carrying a tag, on Danbooru itself. */
export function tagPostsLink(tag: string): string {
  return `${DANBOORU}/posts?tags=${encodeURIComponent(tag)}`
}

/** The tag's wiki page: what it is, who it belongs to, when it is meant to be used. */
export function wikiLink(tag: string): string {
  return `${DANBOORU}/wiki_pages/${encodeURIComponent(tag)}`
}

/**
 * A link back into danfeed with this search in the box.
 *
 * Built from the current origin rather than a hard-coded host, so it works from localhost during
 * development and from the deployment in public. The rating is deliberately left out: which
 * ratings the recipient sees is their setting to make, not the sender's.
 */
export function searchLink(query: string): string {
  const url = new URL('/', location.href)
  url.searchParams.set('q', query.trim())
  return url.toString()
}
