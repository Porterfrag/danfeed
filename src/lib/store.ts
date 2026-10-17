import type { MediaItem } from '../types'

export type { RatingLevel } from './tagQuery'
import type { RatingLevel } from './tagQuery'

const K = {
  saved: 'danfeed.saved.v1',
  settings: 'danfeed.settings.v1',
  recent: 'danfeed.recent.v1',
  related: 'danfeed.related.v1',
} as const

/** How many searches the box remembers. */
const RECENT_LIMIT = 8
const RECENT_MAX = 100

export interface Settings {
  /** Skip videos larger than this when autoloading. 0 disables the cap. */
  maxVideoMb: number
  /** Start with audio unmuted. */
  unmute: boolean
  /** Which ratings the feed is allowed to show. Defaults to the safe one. */
  rating: RatingLevel
}

export const DEFAULT_SETTINGS: Settings = {
  maxVideoMb: 20,
  unmute: false,
  rating: 'general',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or private mode. Non-fatal: the session still works.
  }
}

const RATING_LEVELS: RatingLevel[] = ['general', 'sensitive', 'all']

export function loadSettings(): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) }
  // Guard against a hand-edited or future value: an unknown rating must not leak the
  // literal string "undefined" into the search, which would silently match nothing.
  if (!RATING_LEVELS.includes(merged.rating)) merged.rating = DEFAULT_SETTINGS.rating
  return merged
}

export function saveSettings(settings: Settings) {
  write(K.settings, settings)
}

export function loadSaved(): MediaItem[] {
  const items = read<MediaItem[]>(K.saved, [])
  if (!Array.isArray(items)) return []
  return items.map(normalizeItem)
}

/**
 * Saved items outlive the code that wrote them. An entry saved before `artists`
 * existed has no such field, and a renderer that assumes an array would throw on it.
 * Repair the shape here — the one boundary where stored JSON enters the app.
 */
function normalizeItem(item: MediaItem): MediaItem {
  return {
    ...item,
    tags: Array.isArray(item.tags) ? item.tags : [],
    artists: Array.isArray(item.artists) ? item.artists : [],
    characters: Array.isArray(item.characters) ? item.characters : [],
    copyrights: Array.isArray(item.copyrights) ? item.copyrights : [],
    metaTags: Array.isArray(item.metaTags) ? item.metaTags : [],
  }
}

export function saveSaved(items: MediaItem[]) {
  write(K.saved, items)
}

export function loadRecent(): string[] {
  const list = read<string[]>(K.recent, [])
  if (!Array.isArray(list)) return []
  return list
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    .slice(0, RECENT_LIMIT)
}

export function saveRecent(list: string[]) {
  write(K.recent, list)
}

/**
 * Put a finished search at the front of the history.
 *
 * Typing `chun` and then `chun-li` is one search, not two: when the newest entry is a prefix of
 * the new query it is replaced rather than appended, so pausing mid-word does not fill the list
 * with fragments. Searching something already in the list promotes it instead of duplicating it.
 *
 * The search runs on a debounce as you type, so "finished" here means "a request went out with
 * this query" — see the caller in useFeed.
 */
export function recordRecent(list: string[], query: string): string[] {
  const clean = query.trim().slice(0, RECENT_MAX)
  if (!clean) return list
  const newest = list[0]
  const rest = list.filter(
    (entry) => entry !== clean && !(newest !== undefined && entry === newest && clean.startsWith(newest)),
  )
  return [clean, ...rest].slice(0, RECENT_LIMIT)
}

/**
 * Add restored searches under the ones already here.
 *
 * Appending rather than recording: those entries came from another browser and are older than
 * anything done in this one, so the newest local search keeps the front of the list.
 */
export function mergeRecent(current: string[], incoming: string[]): string[] {
  const seen = new Set(current)
  return [...current, ...incoming.filter((entry) => !seen.has(entry))].slice(0, RECENT_LIMIT)
}

/** What an exported file contains. `format` is bumped if the shape ever changes. */
export const BACKUP_FORMAT = 1

export interface Backup {
  app: 'danfeed'
  format: number
  exportedAt: string
  saved: MediaItem[]
  recent: string[]
  settings: Settings
}

export function buildBackup(saved: MediaItem[], recent: string[], settings: Settings): string {
  const backup: Backup = {
    app: 'danfeed',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    saved,
    recent,
    settings,
  }
  return JSON.stringify(backup, null, 2)
}

export interface RestoredBackup {
  saved: MediaItem[]
  recent: string[]
}

/**
 * Read a backup file, or return null when it is not one.
 *
 * Settings travel in the file so an export is a complete record of what this browser held, but
 * they are deliberately not applied on restore: a file made with Everything on would otherwise
 * unlock unfiltered content simply by being imported. The footer keeps the rating a decision the
 * person in front of this browser made.
 */
export function parseBackup(text: string): RestoredBackup | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const file = parsed as Partial<Backup>
  if (file.app !== 'danfeed' || !Array.isArray(file.saved)) return null

  return {
    saved: file.saved.filter(isItemLike).map(normalizeItem),
    recent: Array.isArray(file.recent)
      ? file.recent
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
          .slice(0, RECENT_LIMIT)
      : [],
  }
}

/** Enough of a saved item to be worth restoring; normalizeItem repairs the rest. */
function isItemLike(item: unknown): item is MediaItem {
  if (typeof item !== 'object' || item === null) return false
  const entry = item as Partial<MediaItem>
  return typeof entry.key === 'string' && entry.key !== '' && typeof entry.src === 'string' && entry.src !== ''
}

/**
 * Add a restored list to what is already saved, newest first.
 *
 * Restoring is additive: a backup can never delete something the browser already has, so the
 * worst case of importing the wrong file is extra entries, never a loss.
 */
export function mergeSaved(
  current: MediaItem[],
  incoming: MediaItem[],
): { saved: MediaItem[]; added: number; duplicates: number } {
  const keys = new Set(current.map((item) => item.key))
  const added = incoming.filter((item) => !keys.has(item.key))
  return { saved: [...added, ...current], added: added.length, duplicates: incoming.length - added.length }
}

/**
 * Whether the related-tags sheet has ever been opened in this browser.
 *
 * It gates exactly one thing: fetching related tags for the slide in front, before the sheet is
 * opened. That is a request per slide, which is only worth spending for someone who has shown
 * they look at the list. Not a setting, not part of a backup: it is a fact about usage, and a
 * restored file does not change what this browser has done.
 */
export function loadRelatedUsed(): boolean {
  return read<boolean>(K.related, false) === true
}

export function markRelatedUsed(): void {
  write(K.related, true)
}
