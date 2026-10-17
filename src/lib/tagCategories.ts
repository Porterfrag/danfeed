import type { MediaItem } from '../types'

export type TagCategoryKey = 'artist' | 'character' | 'copyright' | 'general' | 'meta'

export interface CategorySpec {
  /** What the family is called in the UI. `copyright` is Danbooru's name for a series. */
  label: string
  /** Dot colour, following Danbooru's own taxonomy. */
  dot: string
  /** The same hue as a tinted badge; the search panel labels its rows with this. */
  badge: string
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
 * Shared by the slide row, the all-tags sheet and the search panel's badges, so they can never
 * disagree about what a category is called or which colour it wears.
 */
export const TAG_CATEGORY: Record<TagCategoryKey, CategorySpec> = {
  artist: {
    label: 'Artist',
    dot: 'bg-red-400',
    badge: 'bg-red-400/15 text-red-300',
    aria: 'Show more by artist',
    read: (i) => i.artists,
  },
  character: {
    label: 'Character',
    dot: 'bg-green-400',
    badge: 'bg-green-400/15 text-green-300',
    aria: 'Show more of character',
    read: (i) => i.characters,
  },
  copyright: {
    label: 'Series',
    dot: 'bg-purple-400',
    badge: 'bg-purple-400/15 text-purple-300',
    aria: 'Show more from',
    read: (i) => i.copyrights,
  },
  general: {
    label: 'General',
    dot: 'bg-sky-400',
    // General is the default family and most searches are general tags, so its badge stays
    // neutral — the same "quieter than the entities" treatment the slide chips get.
    badge: 'bg-white/10 text-white/55',
    aria: 'Show more with tag',
    read: generalTags,
  },
  meta: {
    label: 'Meta',
    dot: 'bg-yellow-400',
    badge: 'bg-yellow-400/15 text-yellow-300',
    aria: 'Show more with meta tag',
    read: (i) => i.metaTags,
  },
}

/** Danbooru's tag-category integers, as /autocomplete.json returns them. 2 is unused. */
const CATEGORY_BY_NUMBER: Record<number, TagCategoryKey> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
}

/**
 * The family a tag belongs to, given the category number the autocomplete API returned.
 * Anything unexpected is treated as general, so a new category cannot blank a row.
 */
export function categorySpec(number: number): CategorySpec {
  return TAG_CATEGORY[CATEGORY_BY_NUMBER[number] ?? 'general']
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
