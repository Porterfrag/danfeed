import type { MediaItem } from '../types'

export type TagCategoryKey = 'artist' | 'character' | 'copyright' | 'general' | 'meta'

interface CategorySpec {
  /** What the family is called in the UI. `copyright` is Danbooru's name for a series. */
  label: string
  /** Dot colour, following Danbooru's own taxonomy. */
  dot: string
  /** Screen-reader text for a chip that searches one of these tags. */
  aria: string
  /** This post's tags in that family, in canonical searchable form. */
  read: (item: MediaItem) => string[]
}

/**
 * General is derived rather than fetched.
 *
 * `tag_string` holds every category but is not split, and Danbooru returns it alphabetically,
 * so the four known families are subtracted from it and whatever is left is general. Deriving
 * it this way means a category Danbooru adds later surfaces as a general tag instead of
 * silently vanishing from the UI.
 */
function generalTags(item: MediaItem): string[] {
  const known = new Set([...item.artists, ...item.characters, ...item.copyrights, ...item.metaTags])
  return item.tags.filter((tag) => !known.has(tag))
}

/**
 * The five tag families, in the colours Danbooru itself uses — artist red, character green,
 * copyright purple, general blue, meta yellow.
 *
 * Shared by the slide row and the all-tags sheet so the two can never disagree about what a
 * category is called or which tags belong to it.
 */
export const TAG_CATEGORY: Record<TagCategoryKey, CategorySpec> = {
  artist: {
    label: 'Artist',
    dot: 'bg-red-400',
    aria: 'Show more by artist',
    read: (i) => i.artists,
  },
  character: {
    label: 'Character',
    dot: 'bg-green-400',
    aria: 'Show more of character',
    read: (i) => i.characters,
  },
  copyright: {
    label: 'Series',
    dot: 'bg-purple-400',
    aria: 'Show more from',
    read: (i) => i.copyrights,
  },
  general: {
    label: 'General',
    dot: 'bg-sky-400',
    aria: 'Show more with tag',
    read: generalTags,
  },
  meta: {
    label: 'Meta',
    dot: 'bg-yellow-400',
    aria: 'Show more with meta tag',
    read: (i) => i.metaTags,
  },
}

/** Display order, for both the slide row and the all-tags sheet. */
export const CATEGORY_ORDER: TagCategoryKey[] = [
  'artist',
  'character',
  'copyright',
  'general',
  'meta',
]

export interface CategoryGroup {
  key: TagCategoryKey
  label: string
  dot: string
  tags: string[]
}

/** Every non-empty family on one post, in display order. */
export function categoriesOf(item: MediaItem): CategoryGroup[] {
  const groups: CategoryGroup[] = []
  for (const key of CATEGORY_ORDER) {
    const spec = TAG_CATEGORY[key]
    const tags = spec.read(item)
    if (tags.length > 0) groups.push({ key, label: spec.label, dot: spec.dot, tags })
  }
  return groups
}
