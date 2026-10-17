import type { MediaItem } from '../types'

const K = {
  saved: 'danfeed.saved.v1',
  settings: 'danfeed.settings.v1',
} as const

export interface Settings {
  /** Skip videos larger than this when autoloading. 0 disables the cap. */
  maxVideoMb: number
  /** Start with audio unmuted. */
  unmute: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  maxVideoMb: 20,
  unmute: false,
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

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K.settings, {}) }
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
