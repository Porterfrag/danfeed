import { useCallback, useEffect, useRef, useState } from 'react'
import { autocompleteTags, formatCount } from '../lib/danbooru'
import type { TagSuggestion } from '../lib/danbooru'
import { categorySpec } from '../lib/tagCategories'
import { applySuggestion, splitQuery } from '../lib/tagInput'
import { IconHistory, IconSearch } from './icons'

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

interface Props {
  value: string
  onChange: (value: string) => void
  /** Past searches, newest first. Offered when the box is empty and focused. */
  recents: string[]
  onClearRecents: () => void
  /**
   * Bumped by the `/` shortcut. A counter rather than a flag so that pressing it twice in a row
   * both do something — the second press should focus the box again after the first was blurred.
   */
  focusSignal: number
}

export function TagSearch({ value, onChange, recents, onClearRecents, focusSignal }: Props) {
  const [items, setItems] = useState<TagSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [focused, setFocused] = useState(false)
  const [recentsHidden, setRecentsHidden] = useState(false)
  /**
   * Whether the current value came from this box or was set from outside.
   *
   * Same distinction as `typedRef`, kept in state because it is read during render while
   * `typedRef` is not allowed there.
   */
  const [boxOwnsValue, setBoxOwnsValue] = useState(true)

  const gen = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * The last value that actually came out of this input.
   *
   * Text reaches the box two ways: typed into it, or set from outside — tapping a tag chip
   * on a slide, tapping the logo to reset the feed, or opening a shared `?q=` link. Suggestions
   * are a typing aid, so only the first should fetch anything or open the panel. Without this
   * the two are indistinguishable, and browsing a tag dropped the suggestion list over the feed
   * the user was trying to look at.
   *
   * Starts empty rather than at the initial value: on the first render nothing has come out of
   * the box yet, so a seeded search counts as set-from-outside and comes up quietly.
   */
  const typedRef = useRef('')

  // `/` from anywhere in the feed. Done imperatively rather than with autoFocus, which would
  // steal the caret on every mount — and this box mounts once, behind the whole feed.
  useEffect(() => {
    if (focusSignal === 0) return
    inputRef.current?.focus()
  }, [focusSignal])

  // Complete only the word being typed, keeping earlier tags intact.
  const { token } = splitQuery(value)
  const query = token.trim()

  useEffect(() => {
    if (value !== typedRef.current) {
      // Someone else set the text — a chip, the logo, a cleared search, a shared link. Put the
      // panel away rather than completing their word, and let the box go: a search the user did
      // not type has no business holding their keyboard open, and a focus left behind would drop
      // the history panel over the very feed the tap was meant to show.
      setBoxOwnsValue(false)
      setItems([])
      setOpen(false)
      setLoading(false)
      setDone(false)
      inputRef.current?.blur()
      return
    }

    setBoxOwnsValue(true)

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
      const next = applySuggestion(value, tag.value)
      // This text came out of the box, so the bookkeeping follows it. Left stale, an accepted
      // suggestion would look like an outside change and the box would be blurred out from
      // under someone who is composing a second tag.
      typedRef.current = next
      onChange(next)
      setOpen(false)
      setItems([])
      setDone(false)
      inputRef.current?.focus()
    },
    [value, onChange],
  )

  /**
   * Re-running a search from the history.
   *
   * The text is deliberately set the way a chip sets it: `typedRef` is left behind, so the
   * effect above sees outside text — the panel stays shut and no autocomplete request goes out
   * for a query the user picked rather than typed.
   */
  const pickRecent = useCallback(
    (entry: string) => {
      onChange(entry)
      setItems([])
      setOpen(false)
      inputRef.current?.focus()
    },
    [onChange],
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
      setRecentsHidden(true)
    }
  }

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (highlight < 0) return
    const row = listRef.current?.children[highlight] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  /**
   * History is only offered for a box the user is in and emptied themselves.
   *
   * A trailing space left behind by accepting a suggestion leaves the current *token* empty,
   * and a chip or the logo can empty the whole box from outside — neither should drop a list
   * over the feed. Hence the raw value is what gets checked, alongside whether the box is the
   * one that put it there.
   */
  const showRecents =
    focused &&
    value.trim() === '' &&
    boxOwnsValue &&
    recents.length > 0 &&
    !recentsHidden

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
          setRecentsHidden(false)
          onChange(e.target.value)
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true)
          setRecentsHidden(false)
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
        aria-expanded={open || showRecents}
        aria-autocomplete="list"
        aria-controls="tag-suggestions"
        className="h-9 w-full rounded-full border border-white/10 bg-white/[0.07] pl-8 pr-8 font-mono text-sm text-white placeholder:font-sans placeholder:text-white/40 focus:border-white/25 focus:outline-none"
      />

      {loading && (
        <span className="df-spin pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white/20 border-t-white/70" />
      )}

      {showEmpty && (
        <p className="absolute left-0 right-0 top-full mt-1 rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-2xs text-white/40">
          No tag matches “{query}”
        </p>
      )}

      {open && items.length > 0 && (
        <div
          ref={listRef}
          id="tag-suggestions"
          role="listbox"
          className="df-fade-in scroll-quiet absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-neutral-900 py-1 shadow-2xl"
        >
          {items.map((tag, index) => {
            const cat = categorySpec(tag.category)
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
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/90">
                  {tag.label}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium ${cat.badge}`}
                >
                  {cat.label}
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-2xs tabular-nums text-white/30">
                  {formatCount(tag.postCount)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {showRecents && (
        <div className="df-fade-in absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-white/10 bg-neutral-900 shadow-2xl">
          <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
            <span className="text-2xs font-medium uppercase tracking-wide text-white/35">
              Recent
            </span>
            <button
              type="button"
              aria-label="Clear recent searches"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onClearRecents()
                setRecentsHidden(true)
              }}
              className="text-2xs text-white/45 transition hover:text-white/80"
            >
              Clear
            </button>
          </div>
          <div id="tag-suggestions" role="listbox" className="pb-1">
            {recents.map((entry) => (
              <button
                key={entry}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={`Recent search ${entry}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickRecent(entry)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-white/10"
              >
                <IconHistory className="h-3.5 w-3.5 shrink-0 text-white/30" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/90">{entry}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
