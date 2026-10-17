import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaItem } from './types'
import { Feed } from './components/Feed'
import { AddUrlSheet } from './components/AddUrlSheet'
import { SettingsSheet } from './components/SettingsSheet'
import type { RestoreOutcome } from './components/SettingsSheet'
import { SavedSheet } from './components/SavedSheet'
import { ShareSheet } from './components/ShareSheet'
import { RelatedSheet } from './components/RelatedSheet'
import { ShortcutsSheet } from './components/ShortcutsSheet'
import { TagActionsSheet } from './components/TagActionsSheet'
import type { TagTarget } from './components/TagActionsSheet'
import { TagsSheet } from './components/TagsSheet'
import { LiveRegion } from './components/LiveRegion'
import { useFeed } from './hooks/useFeed'
import { announce } from './lib/announce'
import {
  buildBackup,
  loadRecent,
  loadRelatedUsed,
  loadSaved,
  loadSettings,
  markRelatedUsed,
  mergeRecent,
  mergeSaved,
  parseBackup,
  recordRecent,
  saveRecent,
  saveSaved,
  saveSettings,
} from './lib/store'
import type { Settings } from './lib/store'
import { backupFilename, downloadText } from './lib/download'

type SheetName = 'add' | 'saved' | 'settings' | null

/**
 * The `?q=` of a shared link, if there is one.
 *
 * The only thing the app reads out of the URL — there is no router behind this. Kept separate
 * from consuming it so the address bar is not stripped inside a state initialiser, which React
 * is free to run twice.
 */
function sharedQuery(): string {
  try {
    return new URLSearchParams(location.search).get('q')?.trim() ?? ''
  } catch {
    return ''
  }
}

export default function App() {
  const [initialQuery] = useState(sharedQuery)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [recent, setRecent] = useState<string[]>(() => loadRecent())

  /**
   * Remember a search that actually went out.
   *
   * Returning `prev` when nothing changed matters: flipping a filter re-runs the search effect
   * with the same query, and a fresh array identity there would re-render the feed for nothing.
   */
  const recordQuery = useCallback((query: string) => {
    setRecent((prev) => {
      const next = recordRecent(prev, query)
      return next.length === prev.length && next.every((entry, i) => entry === prev[i])
        ? prev
        : next
    })
  }, [])

  const feed = useFeed(settings.rating, { onSearch: recordQuery, initialQuery })
  const { resetToDefault, searchTag } = feed
  const [saved, setSaved] = useState<MediaItem[]>(() => loadSaved())
  const [extras, setExtras] = useState<MediaItem[]>([])
  const [sheet, setSheet] = useState<SheetName>(null)
  /** The post whose full tag list is open, if any. */
  const [tagsItem, setTagsItem] = useState<MediaItem | null>(null)
  /** The post whose share sheet is open, if any. */
  const [shareItem, setShareItem] = useState<MediaItem | null>(null)
  /** The tag whose actions sheet is open, if any. */
  const [tagTarget, setTagTarget] = useState<TagTarget | null>(null)
  /** The tag whose related list is open, if any. */
  const [relatedTarget, setRelatedTarget] = useState<TagTarget | null>(null)
  /** Whether that sheet has ever been opened here — it decides whether the app warms the list. */
  const [relatedUsed, setRelatedUsed] = useState<boolean>(() => loadRelatedUsed())
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [scrollSignal, setScrollSignal] = useState(0)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    saveSaved(saved)
  }, [saved])

  useEffect(() => {
    saveRecent(recent)
  }, [recent])

  // A shared link is a starting point, not a mode the address bar keeps asserting after the
  // search has been changed or cleared.
  useEffect(() => {
    if (initialQuery) history.replaceState(null, '', location.pathname)
  }, [initialQuery])

  /**
   * What the tab, the bookmark and the history entry say.
   *
   * The address bar deliberately stops carrying the query once a shared link has been read, so
   * the title is the only thing a browser remembers about which search a tab is showing — and
   * with several tabs open, it is the only way to tell them apart.
   */
  useEffect(() => {
    const query = feed.queryInput.trim()
    document.title = query ? `${query} — danfeed` : 'danfeed'
  }, [feed.queryInput])

  const muted = !settings.unmute

  /**
   * Whether anything is in front of the feed.
   *
   * Drives two things at once: the feed's keyboard shortcuts stand down, and the feed itself is
   * made `inert`, so Tab and a screen reader cannot wander into slides hidden behind a sheet.
   * The sheets are siblings of the feed, not children, or this would disable them too.
   */
  const sheetOpen =
    sheet !== null ||
    tagsItem !== null ||
    shareItem !== null ||
    tagTarget !== null ||
    relatedTarget !== null ||
    shortcutsOpen

  const savedKeys = useMemo(() => new Set(saved.map((item) => item.key)), [saved])

  const toggleSave = useCallback(
    (item: MediaItem) => {
      // Read before the update: the setter's function form keeps this callback render-independent
      // of `saved`, but the announcement has to happen outside it, and it needs to know which way
      // the tap went.
      const already = saved.some((entry) => entry.key === item.key)
      setSaved((prev) =>
        prev.some((entry) => entry.key === item.key)
          ? prev.filter((entry) => entry.key !== item.key)
          : [item, ...prev],
      )
      announce(already ? 'Removed from your list' : 'Saved to your list')
    },
    [saved],
  )

  const toggleMute = useCallback(() => {
    setSettings((prev) => ({ ...prev, unmute: !prev.unmute }))
  }, [])

  const addItem = useCallback((item: MediaItem) => {
    setExtras((prev) => [item, ...prev.filter((entry) => entry.key !== item.key)])
    setScrollSignal((n) => n + 1)
  }, [])

  /** Everything this browser holds, as one file. */
  const exportBackup = useCallback(() => {
    downloadText(backupFilename(), buildBackup(saved, recent, settings))
  }, [saved, recent, settings])

  /**
   * Merge a backup file into what is here.
   *
   * Additive on purpose: the worst a wrong file can do is add entries. Settings in the file are
   * deliberately not applied — a file should not be able to change what this browser is allowed
   * to show without the person at the keyboard touching that switch themselves.
   */
  const restoreBackup = useCallback(
    (text: string): RestoreOutcome | null => {
      const backup = parseBackup(text)
      if (!backup) return null

      const merged = mergeSaved(saved, backup.saved)
      setSaved(merged.saved)

      const before = new Set(recent)
      const mergedRecent = mergeRecent(recent, backup.recent)
      setRecent(mergedRecent)

      const newRecent = mergedRecent.filter((entry) => !before.has(entry)).length
      announce(`Backup merged: ${merged.added} new saved posts, ${newRecent} new searches.`)

      return {
        added: merged.added,
        duplicates: merged.duplicates,
        recent: newRecent,
      }
    },
    [saved, recent],
  )

  /**
   * Tapping the danfeed logo behaves like a page reload: back to the top of the
   * default feed, with any pasted URLs and the current search cleared.
   */
  const goHome = useCallback(() => {
    setExtras([])
    setSheet(null)
    setTagsItem(null)
    setShareItem(null)
    setTagTarget(null)
    setRelatedTarget(null)
    setShortcutsOpen(false)
    setScrollSignal((n) => n + 1)
    resetToDefault()
  }, [resetToDefault])

  /**
   * Tapping a tag chip searches that exact tag, so the feed becomes "everything else
   * with this artist / character / series" and the tag shows up in the search box —
   * visible, editable and clearable rather than a hidden mode.
   */
  const browseTag = useCallback(
    (tag: string) => {
      setScrollSignal((n) => n + 1)
      searchTag(tag)
    },
    [searchTag],
  )

  /**
   * Run one tag as a fresh search from whichever sheet offered it, closing the sheets on the way.
   *
   * The actions sheet can be opened from the all-tags list, and the related list from the actions
   * sheet, so a search started from any of them has to put every one away: the feed underneath is
   * about to change completely, and a sheet left standing would be about a post that is gone.
   */
  const searchFromSheets = useCallback(
    (tag: string) => {
      setTagsItem(null)
      setTagTarget(null)
      setRelatedTarget(null)
      browseTag(tag)
    },
    [browseTag],
  )

  /**
   * Open the related list for a tag.
   *
   * The first open is also what switches on warming it: from here on, whichever slide comes to
   * rest in front gets its related list asked for in the background, so the next press of the
   * button opens onto an answer instead of a spinner. The flag lives in localStorage because it
   * is a fact about this browser's usage, not a setting to restore.
   */
  const openRelated = useCallback((target: TagTarget) => {
    setRelatedUsed(true)
    markRelatedUsed()
    setRelatedTarget(target)
  }, [])

  const items = useMemo(() => [...extras, ...feed.items], [extras, feed.items])

  const maxBytes = settings.maxVideoMb * 1024 * 1024

  return (
    <>
      {/* `inert` while anything is in front: Tab and a screen reader stop at the sheet, and the
          slides behind it stop being reachable. The sheets are siblings, not children. */}
      <div inert={sheetOpen} className="h-dvh">
        <Feed
          items={items}
          loading={feed.loading}
          error={feed.error}
          hasMore={feed.hasMore}
          onLoadMore={feed.loadMore}
          onRetry={feed.retry}
          onClearHistory={feed.clearHistory}
          tagLimit={feed.tagLimit}
          onRemoveTag={feed.removeTag}
          onClearSearch={() => {
            feed.setQueryInput('')
            feed.setChip('all')
          }}
          chip={feed.chip}
          setChip={feed.setChip}
          queryInput={feed.queryInput}
          setQueryInput={feed.setQueryInput}
          savedKeys={savedKeys}
          onSave={toggleSave}
          muted={muted}
          onToggleMute={toggleMute}
          maxBytes={maxBytes}
          scrollToTopSignal={scrollSignal}
          onAddClick={() => setSheet('add')}
          onSavedClick={() => setSheet('saved')}
          onSettingsClick={() => setSheet('settings')}
          onHomeClick={goHome}
          nsfw={settings.rating !== 'general'}
          ratingMark={
            settings.rating === 'all' ? 'E' : settings.rating === 'sensitive' ? 'M' : null
          }
          onTagClick={browseTag}
          onTagActions={setTagTarget}
          onShowAllTags={setTagsItem}
          recents={recent}
          onClearRecents={() => {
            setRecent([])
            announce('Recent searches cleared')
          }}
          onShare={setShareItem}
          onRelated={openRelated}
          relatedUsed={relatedUsed}
          onShowShortcuts={() => setShortcutsOpen(true)}
          shortcutsEnabled={!sheetOpen}
        />
      </div>

      <AddUrlSheet
        open={sheet === 'add'}
        onClose={() => setSheet(null)}
        onAdd={addItem}
      />

      <SavedSheet
        open={sheet === 'saved'}
        onClose={() => setSheet(null)}
        items={saved}
        onPlay={(item) => {
          addItem(item)
          setSheet(null)
        }}
        onRemove={(key) => {
          setSaved((prev) => prev.filter((entry) => entry.key !== key))
          announce('Removed from your list')
        }}
      />

      <SettingsSheet
        open={sheet === 'settings'}
        onClose={() => setSheet(null)}
        settings={settings}
        onChange={setSettings}
        savedCount={saved.length}
        onClearSaved={() => {
          setSaved([])
          announce('Saved list cleared')
        }}
        onClearHistory={feed.clearHistory}
        onExport={exportBackup}
        onRestore={restoreBackup}
      />

      <ShareSheet
        open={shareItem !== null}
        item={shareItem}
        query={feed.queryInput}
        onClose={() => setShareItem(null)}
      />

      <TagsSheet
        item={tagsItem}
        onClose={() => setTagsItem(null)}
        onPick={searchFromSheets}
        onActions={setTagTarget}
      />

      <TagActionsSheet
        target={tagTarget}
        onClose={() => setTagTarget(null)}
        onSearch={searchFromSheets}
        onRelated={openRelated}
      />

      <RelatedSheet
        target={relatedTarget}
        onClose={() => setRelatedTarget(null)}
        onPick={searchFromSheets}
      />

      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <LiveRegion />
    </>
  )
}
