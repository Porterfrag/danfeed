import type { MediaItem } from '../types'

export type { RatingLevel } from './tagQuery'
import type { RatingLevel } from './tagQuery'

const K = {
  saved: 'danfeed.saved.v1',
  settings: 'danfeed.settings.v1',
} as const

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
  return Array.isArray(items) ? items : []
}

export function saveSaved(items: MediaItem[]) {
  write(K.saved, items)
}
