import { useCallback, useEffect, useRef, useState } from 'react'
import { autocompleteTags } from '../lib/danbooru'
import type { TagSuggestion } from '../lib/danbooru'
import { applySuggestion, splitQuery } from '../lib/tagInput'
import { IconSearch } from './icons'

const CATEGORY: Record<number, { label: string; className: string }> = {
  0: { label: 'General', className: 'bg-white/10 text-white/55' },
  1: { label: 'Artist', className: 'bg-amber-400/15 text-amber-300' },
  3: { label: 'Series', className: 'bg-violet-400/15 text-violet-300' },
  4: { label: 'Character', className: 'bg-emerald-400/15 text-emerald-300' },
  5: { label: 'Meta', className: 'bg-sky-400/15 text-sky-300' },
}

/** Survives remounts, so retyping a prefix is instant. */
const cache = new Map<string, TagSuggestion[]>()
const CACHE_LIMIT = 200

function remember(query: string, rows: TagSuggestion[]) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(query, rows)
}

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

interface Props {
  value: string
  onChange: (value: string) => void
}

export function TagSearch({ value, onChange }: Props) {
  const [items, setItems] = useState<TagSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [focused, setFocused] = useState(false)

  const gen = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * The last value that actually came out of this input.
   *
   * Text reaches the box two ways: typed into it, or set from outside — tapping a tag chip
   * on a slide, or tapping the logo to reset the feed. Suggestions are a typing aid, so
   * only the first should fetch anything or open the panel. Without this the two are
   * indistinguishable, and browsing a tag dropped the suggestion list over the feed the
   * user was trying to look at.
   */
  const typedRef = useRef(value)

  // Complete only the word being typed, keeping earlier tags intact.
  const { token } = splitQuery(value)
  const query = token.trim()

  useEffect(() => {
    if (value !== typedRef.current) {
      // Someone else set the text. Put the panel away rather than completing their word.
      setItems([])
      setOpen(false)
      setLoading(false)
      setDone(false)
      return
    }

    if (!query) {
      setItems([])
      setOpen(false)
      setLoading(false)
      setDone(false)
      return
    }

    const cached = cache.get(query)
    if (cached) {
      setItems(cached)
      setOpen(cached.length > 0)
      setHighlight(-1)
      setLoading(false)
      setDone(true)
      return
    }

    setLoading(true)
    setDone(false)

    const timer = setTimeout(async () => {
      const id = ++gen.current
      try {
        const rows = await autocompleteTags(query)
        if (id !== gen.current) return
        remember(query, rows)
        setItems(rows)
        setOpen(rows.length > 0)
        setHighlight(-1)
      } catch {
        if (id !== gen.current) return
        setItems([])
        setOpen(false)
      } finally {
        if (id === gen.current) {
          setLoading(false)
          setDone(true)
        }
      }
    }, 150)

    return () => clearTimeout(timer)
  }, [value, query])

  const accept = useCallback(
    (tag: TagSuggestion) => {
      // `value` (underscored) is the searchable form; `label` is display-only.
      onChange(applySuggestion(value, tag.value))
      setOpen(false)
      setItems([])
      setDone(false)
      inputRef.current?.focus()
    },
    [value, onChange],
  )

  const move = useCallback(
    (delta: number) => {
      if (items.length === 0) return
      setHighlight((prev) => {
        if (prev < 0) return delta > 0 ? 0 : items.length - 1
        return (prev + delta + items.length) % items.length
      })
    },
    [items.length],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      if (open && highlight >= 0 && items[highlight]) {
        e.preventDefault()
        accept(items[highlight])
      } else {
        setOpen(false)
      }
    } else if (e.key === 'Tab') {
      if (open && items.length > 0) {
        e.preventDefault()
        accept(items[highlight >= 0 ? highlight : 0])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (highlight < 0) return
    const row = listRef.current?.children[highlight] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const showEmpty =
    focused && done && !loading && items.length === 0 && query.length >= 2 && !open

  return (
    <div className="relative min-w-0 flex-1">
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-white/45" />

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          typedRef.current = e.target.value
          onChange(e.target.value)
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true)
          if (items.length > 0) setOpen(true)
        }}
        onBlur={() => {
          setFocused(false)
          setOpen(false)
        }}
        placeholder="Search tags…"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="tag-suggestions"
        className="h-9 w-full rounded-full border border-white/10 bg-white/10 pl-8 pr-8 text-sm text-white placeholder:text-white/40 focus:border-white/25 focus:outline-none"
      />

      {loading && (
        <span className="df-spin pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white/20 border-t-white/70" />
      )}

      {showEmpty && (
        <p className="absolute left-0 right-0 top-full mt-1 rounded-xl border border-white/10 bg-neutral-900/95 px-3 py-2 text-[11px] text-white/40 backdrop-blur-md">
          No tag matches “{query}”
        </p>
      )}

      {open && items.length > 0 && (
        <div
          ref={listRef}
          id="tag-suggestions"
          role="listbox"
          className="df-fade-in absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur-md"
        >
          {items.map((tag, index) => {
            const cat = CATEGORY[tag.category] ?? CATEGORY[0]
            return (
              <button
                key={tag.value}
                type="button"
                role="option"
                aria-selected={index === highlight}
                // preventDefault keeps focus in the input so the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(tag)}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition ${
                  index === highlight ? 'bg-white/12' : 'hover:bg-white/8'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/90">
                  {tag.label}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${cat.className}`}
                >
                  {cat.label}
                </span>
                <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-white/30">
                  {formatCount(tag.postCount)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
