/**
 * Danbooru rejects searches with more than two "counted" tags (anonymous and
 * regular accounts alike — only Gold+ raises the cap):
 *
 *   422 PostQuery::TagLimitError "You cannot search for more than 2 tags at a time."
 *
 * Some metatags are free, though. Verified against the live API:
 *
 *   counted : plain tags, negations (-tag), order:*, pool:*
 *   free    : rating:* score:* id:* date:* width:* height:* filetype:*
 *             favcount:* status:* age:* parent:*
 *
 * The free list is a heuristic, not a guarantee: if an unknown metatag turns out
 * to be counted we under-count locally and the server's 422 is surfaced instead.
 */

export const TAG_LIMIT = 2

/** Metatags known to consume a search slot. */
const COUNTED_METATAGS = new Set(['order', 'pool'])

export interface TagToken {
  raw: string
  counted: boolean
}

export function tokenize(query: string): string[] {
  return query.split(/\s+/).filter(Boolean)
}

export function classifyToken(raw: string): TagToken {
  const tag = raw.trim()
  if (!tag) return { raw: tag, counted: false }

  const colon = tag.indexOf(':')
  if (colon > 0) {
    // Strip a leading negation so `-order:score` is still treated as a metatag.
    const key = tag.slice(0, colon).replace(/^-/, '').toLowerCase()
    return { raw: tag, counted: COUNTED_METATAGS.has(key) }
  }

  return { raw: tag, counted: true }
}

export interface TagAnalysis {
  tokens: TagToken[]
  /** Just the tokens that consume a search slot. */
  counted: string[]
  over: boolean
}

export function analyzeTags(query: string): TagAnalysis {
  const tokens = tokenize(query).map(classifyToken)
  const counted = tokens.filter((token) => token.counted).map((token) => token.raw)
  return { tokens, counted, over: counted.length > TAG_LIMIT }
}

/** Remove the first occurrence of a tag from a space-separated query. */
export function removeToken(query: string, raw: string): string {
  const parts = tokenize(query)
  const index = parts.indexOf(raw)
  if (index === -1) return query
  parts.splice(index, 1)
  return parts.join(' ')
}
