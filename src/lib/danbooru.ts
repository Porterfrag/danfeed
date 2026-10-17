import type { DanbooruPost, MediaItem, PostKind } from '../types'

export const API = 'https://danbooru.donmai.us'

/** Trimmed payload: ~70% smaller than a full post and still contains everything we render. */
const ONLY = [
  'id',
  'file_ext',
  'file_size',
  'file_url',
  'large_file_url',
  'preview_file_url',
  'image_width',
  'image_height',
  'rating',
  'score',
  'tag_string',
  'tag_string_artist',
  'tag_string_character',
  'tag_string_copyright',
  'tag_string_meta',
  'media_asset',
].join(',')

export type BooruErrorKind = 'blocked' | 'http' | 'network' | 'rate' | 'input' | 'taglimit'

export class BooruError extends Error {
  kind: BooruErrorKind
  /** The HTTP status, when there was one. Decides whether the failure is worth repeating. */
  status?: number

  constructor(kind: BooruErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'BooruError'
    this.kind = kind
    this.status = status
  }
}

/**
 * Statuses worth another go. Danbooru restarts and sheds load with these; the answer to the same
 * question a moment later is usually a good one.
 */
const RETRY_STATUSES = new Set([500, 502, 503, 504])
/** Backoff between attempts, plus jitter. Two retries: three requests in all. */
const RETRY_DELAYS = [400, 1200]

function isTransient(error: unknown): boolean {
  if (!(error instanceof BooruError)) return false
  if (error.kind === 'network') return true
  return error.status !== undefined && RETRY_STATUSES.has(error.status)
}

/* ------------------------------------------------------------------ */
/* Request scheduling: keep it polite and serialise access.            */
/* Two lanes, so typing never queues behind a feed load.               */
/* ------------------------------------------------------------------ */

function makeScheduler(minGapMs: number) {
  let chain: Promise<unknown> = Promise.resolve()
  let lastAt = 0

  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = minGapMs - (Date.now() - lastAt)
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait))
      lastAt = Date.now()
      return fn()
    })
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

/** Feed pagination — deliberately slow. */
const schedule = makeScheduler(350)
/** Autocomplete — needs to feel instant, still rate-limit friendly. */
const scheduleFast = makeScheduler(150)

async function getOnce<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      mode: 'cors',
    })
  } catch {
    throw new BooruError('network', 'Could not reach danbooru.donmai.us.')
  }

  if (res.status === 429) {
    throw new BooruError(
      'rate',
      'Danbooru is rate-limiting requests. Pausing for a moment.',
      res.status,
    )
  }
  if (!res.ok) {
    // Danbooru returns a JSON error body; surface its message rather than a bare status code.
    let payload: { error?: string; message?: string } | null = null
    try {
      payload = (await res.json()) as { error?: string; message?: string }
    } catch {
      payload = null
    }

    if (payload?.error === 'PostQuery::TagLimitError') {
      throw new BooruError(
        'taglimit',
        payload.message ?? 'You cannot search for more than 2 tags at a time.',
        res.status,
      )
    }
    if (payload?.message) {
      throw new BooruError('http', payload.message, res.status)
    }
    throw new BooruError('http', `Danbooru responded with HTTP ${res.status}.`, res.status)
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    // Captive portals / ISP blocks answer 200 with an HTML page. Say so instead of "invalid JSON".
    throw new BooruError(
      'blocked',
      'Danbooru answered with a web page instead of data. Your network is intercepting the request.',
    )
  }

  try {
    return (await res.json()) as T
  } catch {
    throw new BooruError('blocked', 'Could not parse the response from Danbooru.')
  }
}

/**
 * Fetch JSON, with a couple of extra goes at transient failures.
 *
 * Danbooru answers 502/503 while it restarts and truncates under load, and a phone moving
 * between networks drops connections; none of that deserves an error card when the same GET a
 * moment later would have worked. 4xx is never repeated — a rejected query is rejected the same
 * way every time — and neither is the typing path, where a late answer is worth less than a
 * quick one, so autocomplete opts out.
 */
async function getJson<T>(url: string, { retry = true }: { retry?: boolean } = {}): Promise<T> {
  const delays = retry ? RETRY_DELAYS : []

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getOnce<T>(url)
    } catch (error) {
      if (attempt >= delays.length || !isTransient(error)) {
        if (attempt > 0 && error instanceof BooruError) {
          // Say that it tried more than once, or the wait before the card reads as a hang.
          throw new BooruError(
            error.kind,
            `${error.message} Tried ${attempt + 1} times.`,
            error.status,
          )
        }
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt] + Math.random() * 150))
    }
  }
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

export function kindOf(post: DanbooruPost): PostKind {
  switch (post.file_ext) {
    case 'zip':
      return 'ugoira'
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'm4v':
      return 'video'
    case 'gif':
      return 'gif'
    default:
      return 'photo'
  }
}

function isWebm(url: string | null | undefined): url is string {
  return !!url && /\.webm(\?|#|$)/i.test(url)
}

/** Danbooru returns tag lists as one space-separated string, or "" when there are none. */
function splitTags(value: string | null | undefined): string[] {
  return value ? value.split(' ').filter(Boolean) : []
}

/**
 * Pick the best renderable source for a post.
 *
 * - photo  -> `large_file_url` (the 850px "sample"); originals can be 20 MB.
 * - video  -> `file_url` (Danbooru ships no transcodes).
 * - gif    -> `file_url`.
 * - ugoira -> the `sample` webm variant, so frame-animation plays as plain video.
 */
export function toItem(post: DanbooruPost): MediaItem | null {
  let kind = kindOf(post)
  let src = ''

  if (kind === 'ugoira') {
    const variant = post.media_asset?.variants?.find(
      (v) => v.type === 'sample' && v.file_ext === 'webm',
    )
    src = variant?.url ?? (isWebm(post.large_file_url) ? post.large_file_url : '')
    if (!src) {
      // No webm preview available: fall back to the still frame.
      kind = 'photo'
      src = post.large_file_url ?? post.preview_file_url ?? ''
    }
  } else if (kind === 'photo') {
    src = post.large_file_url ?? post.file_url ?? post.preview_file_url ?? ''
  } else {
    src = post.file_url ?? ''
  }

  if (!src) return null

  return {
    key: `danbooru:${post.id}`,
    kind,
    src,
    poster: post.preview_file_url ?? undefined,
    width: post.image_width ?? 0,
    height: post.image_height ?? 0,
    bytes: post.file_size ?? undefined,
    rating: post.rating ?? undefined,
    score: post.score ?? undefined,
    // `tags` is every tag on the post; the category lists are what the UI makes
    // browsable, and they are subtracted from `tags` before rendering.
    tags: splitTags(post.tag_string),
    artists: splitTags(post.tag_string_artist),
    characters: splitTags(post.tag_string_character),
    copyrights: splitTags(post.tag_string_copyright),
    metaTags: splitTags(post.tag_string_meta),
    postId: post.id,
    sourceUrl: `${API}/posts/${post.id}`,
    origin: 'danbooru',
  }
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

export interface Page {
  items: MediaItem[]
  /** Tag fragment for the next page, or null when the search is exhausted. */
  next: string | null
}

export async function searchPosts(
  tags: string,
  cursor: string | null,
  limit = 20,
): Promise<Page> {
  const query = [tags.trim(), cursor ?? ''].filter(Boolean).join(' ')
  const url =
    `${API}/posts.json?tags=${encodeURIComponent(query)}` +
    `&limit=${limit}&only=${encodeURIComponent(ONLY)}`

  const posts = await schedule(() => getJson<DanbooruPost[]>(url))
  if (!Array.isArray(posts)) throw new BooruError('http', 'Unexpected response shape from Danbooru.')

  const items = posts
    .map(toItem)
    .filter((item): item is MediaItem => item !== null)

  const lastId = posts.length > 0 ? posts[posts.length - 1].id : null
  const next = posts.length < limit || !lastId ? null : `id:<${lastId}`

  return { items, next }
}

/* ------------------------------------------------------------------ */
/* Tag autocomplete                                                    */
/* ------------------------------------------------------------------ */

export interface TagSuggestion {
  /** Canonical search form, e.g. `hatsune_miku` or `chun-li`. */
  value: string
  /** Human-readable form, e.g. `hatsune miku`. */
  label: string
  /** 0 general · 1 artist · 3 copyright · 4 character · 5 meta */
  category: number
  postCount: number
}

interface AutocompleteRow {
  label?: string
  value?: string
  category?: number
  post_count?: number
  tag?: { post_count?: number }
}

/**
 * Suggest tags for a partial word. `chun` -> `chun-li`.
 *
 * `value` is the string that must go into the query: Danbooru treats `_` as a
 * space inside a tag name, but keeps literal hyphens (`chun-li`), so `label`
 * (spaces) is for display only and must never be searched with.
 */
export async function autocompleteTags(query: string, limit = 8): Promise<TagSuggestion[]> {
  const q = query.trim()
  if (!q) return []

  const url =
    `${API}/autocomplete.json?search%5Bquery%5D=${encodeURIComponent(q)}` +
    `&search%5Btype%5D=tag&limit=${limit}`

  const rows = await scheduleFast(() => getJson<AutocompleteRow[]>(url, { retry: false }))
  if (!Array.isArray(rows)) return []

  return rows
    .filter((row) => typeof row.value === 'string' && row.value.length > 0)
    .map((row) => ({
      value: row.value as string,
      label: row.label || (row.value as string),
      category: row.category ?? 0,
      postCount: row.post_count ?? row.tag?.post_count ?? 0,
    }))
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

/**
 * Human-readable form of a tag, matching Danbooru's own `label` convention: the
 * value with underscores read as spaces. `corn_kuten` -> "corn kuten",
 * `anna_(k0130)` -> "anna (k0130)". Hyphens are literal and stay (`chun-li`).
 *
 * Display only — the searchable form is the tag itself, so never put the result
 * of this into a query.
 */
export function tagLabel(tag: string): string {
  return tag.replace(/_/g, ' ')
}

/* ------------------------------------------------------------------ */
/* Custom URL resolution                                               */
/* ------------------------------------------------------------------ */

/**
 * A pasted URL has no Danbooru taxonomy at all, so every tag category is empty.
 * Built in one place because there are four call sites and four empty arrays each.
 */
function customItem(
  base: Pick<MediaItem, 'key' | 'kind' | 'src' | 'width' | 'height'>,
  extra: Partial<MediaItem> = {},
): MediaItem {
  return {
    tags: [],
    artists: [],
    characters: [],
    copyrights: [],
    metaTags: [],
    ...base,
    ...extra,
    origin: 'custom',
  }
}

function embedFor(url: string): MediaItem | null {
  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/,
  )
  if (yt) {
    const id = yt[1]
    return customItem(
      {
        key: `youtube:${id}`,
        kind: 'embed',
        src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1&loop=1&playlist=${id}&rel=0`,
        width: 16,
        height: 9,
      },
      {
        title: 'YouTube',
        sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      },
    )
  }

  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo) {
    return customItem(
      {
        key: `vimeo:${vimeo[1]}`,
        kind: 'embed',
        src: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1&muted=1&loop=1`,
        width: 16,
        height: 9,
      },
      { title: 'Vimeo', sourceUrl: url },
    )
  }

  return null
}

const VIDEO_RE = /\.(mp4|webm|m4v|mov|ogv)(\?|#|$)/i
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i

/** Turn whatever the user pasted into a playable item. */
export async function resolveUrl(input: string): Promise<MediaItem> {
  const url = input.trim()
  if (!url) throw new BooruError('input', 'Paste a link first.')

  const postMatch = url.match(/danbooru\.donmai\.us\/posts\/(\d+)/i)
  if (postMatch) {
    const post = await schedule(() =>
      getJson<DanbooruPost>(
        `${API}/posts/${postMatch[1]}.json?only=${encodeURIComponent(ONLY)}`,
      ),
    )
    const item = toItem(post)
    if (!item) throw new BooruError('input', 'That post has no playable media.')
    return item
  }

  const embed = embedFor(url)
  if (embed) return embed

  if (VIDEO_RE.test(url)) {
    return customItem({
      key: `custom:${url}`,
      kind: 'video',
      src: url,
      width: 0,
      height: 0,
    })
  }

  if (IMAGE_RE.test(url)) {
    return customItem({
      key: `custom:${url}`,
      kind: /\.gif(\?|#|$)/i.test(url) ? 'gif' : 'photo',
      src: url,
      width: 0,
      height: 0,
    })
  }

  throw new BooruError(
    'input',
    'Unrecognised link. Use a direct media file, a Danbooru post URL, or a YouTube/Vimeo link.',
  )
}
