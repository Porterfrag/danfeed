import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaItem } from './types'
import { Feed } from './components/Feed'
import { AddUrlSheet } from './components/AddUrlSheet'
import { SettingsSheet } from './components/SettingsSheet'
import { SavedSheet } from './components/SavedSheet'
import { useFeed } from './hooks/useFeed'
import { loadSaved, loadSettings, saveSaved, saveSettings } from './lib/store'
import type { Settings } from './lib/store'

type SheetName = 'add' | 'saved' | 'settings' | null

export default function App() {
  const feed = useFeed()
  const { resetToDefault } = feed
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [saved, setSaved] = useState<MediaItem[]>(() => loadSaved())
  const [extras, setExtras] = useState<MediaItem[]>([])
  const [sheet, setSheet] = useState<SheetName>(null)
  const [scrollSignal, setScrollSignal] = useState(0)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    saveSaved(saved)
  }, [saved])

  const muted = !settings.unmute

  const savedKeys = useMemo(() => new Set(saved.map((item) => item.key)), [saved])

  const toggleSave = useCallback((item: MediaItem) => {
    setSaved((prev) =>
      prev.some((entry) => entry.key === item.key)
        ? prev.filter((entry) => entry.key !== item.key)
        : [item, ...prev],
    )
  }, [])

  const toggleMute = useCallback(() => {
    setSettings((prev) => ({ ...prev, unmute: !prev.unmute }))
  }, [])

  const addItem = useCallback((item: MediaItem) => {
    setExtras((prev) => [item, ...prev.filter((entry) => entry.key !== item.key)])
    setScrollSignal((n) => n + 1)
  }, [])

  /**
   * Tapping the danfeed logo behaves like a page reload: back to the top of the
   * default feed, with any pasted URLs and the current search cleared.
   */
  const goHome = useCallback(() => {
    setExtras([])
    setSheet(null)
    setScrollSignal((n) => n + 1)
    resetToDefault()
  }, [resetToDefault])

  const items = useMemo(() => [...extras, ...feed.items], [extras, feed.items])

  const maxBytes = settings.maxVideoMb * 1024 * 1024

  return (
    <>
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
      />

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
        onRemove={(key) => setSaved((prev) => prev.filter((entry) => entry.key !== key))}
      />

      <SettingsSheet
        open={sheet === 'settings'}
        onClose={() => setSheet(null)}
        settings={settings}
        onChange={setSettings}
        savedCount={saved.length}
        onClearSaved={() => setSaved([])}
        onClearHistory={feed.clearHistory}
      />
    </>
  )
}
