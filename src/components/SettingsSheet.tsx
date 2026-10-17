import type { Settings } from '../lib/store'
import type { RatingLevel } from '../lib/tagQuery'
import { Sheet } from './Sheet'
import { IconTrash } from './icons'

interface Props {
  open: boolean
  onClose: () => void
  settings: Settings
  onChange: (settings: Settings) => void
  savedCount: number
  onClearSaved: () => void
  onClearHistory: () => void
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 py-2 text-left"
    >
      <span>
        <span className="block text-sm text-white">{label}</span>
        <span className="block text-xs text-white/45">{hint}</span>
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-white' : 'bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full transition ${
            checked ? 'left-[22px] bg-black' : 'left-0.5 bg-white'
          }`}
        />
      </span>
    </button>
  )
}

const RATING_OPTIONS: Array<{ value: RatingLevel; label: string; hint: string }> = [
  { value: 'general', label: 'Safe', hint: 'General rating only' },
  { value: 'sensitive', label: 'Moderate', hint: 'General + sensitive' },
  { value: 'all', label: 'Everything', hint: 'Includes questionable and explicit' },
]

function RatingSelector({
  value,
  onChange,
}: {
  value: RatingLevel
  onChange: (next: RatingLevel) => void
}) {
  const active = RATING_OPTIONS.find((option) => option.value === value) ?? RATING_OPTIONS[0]
  const explicit = value !== 'general'

  return (
    <div className="pb-4">
      <span className="block text-sm text-white">Content rating</span>
      <p className="mb-2 text-xs text-white/45">{active.hint}</p>

      <div className="flex gap-1 rounded-xl bg-black/40 p-1">
        {RATING_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`flex-1 rounded-lg py-2 text-xs font-medium transition ${
              value === option.value
                ? explicit && option.value === 'all'
                  ? 'bg-rose-500/80 text-white'
                  : explicit
                    ? 'bg-amber-400/80 text-black'
                    : 'bg-white text-black'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {explicit && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          {value === 'sensitive'
            ? 'Sensitive content is now included in the feed.'
            : 'Everything is now included — general, sensitive, questionable and explicit.'}{' '}
          This is saved to this browser only.
        </p>
      )}
    </div>
  )
}

export function SettingsSheet({
  open,
  onClose,
  settings,
  onChange,
  savedCount,
  onClearSaved,
  onClearHistory,
}: Props) {
  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      <div className="divide-y divide-white/10">
        <RatingSelector
          value={settings.rating}
          onChange={(rating) => onChange({ ...settings, rating })}
        />

        <div className="py-3">
          <label htmlFor="max-mb" className="block text-sm text-white">
            Skip videos larger than
          </label>
          <p className="mb-2 text-xs text-white/45">
            Danbooru serves originals only, with no smaller transcode. Big files are held behind a
            tap so swiping never burns data. Set 0 for no limit.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="max-mb"
              type="number"
              min={0}
              max={500}
              value={settings.maxVideoMb}
              onChange={(e) =>
                onChange({ ...settings, maxVideoMb: Math.max(0, Number(e.target.value) || 0) })
              }
              className="h-10 w-24 rounded-lg border border-white/15 bg-black/40 px-3 text-sm text-white focus:border-white/35 focus:outline-none"
            />
            <span className="text-sm text-white/50">MB</span>
          </div>
        </div>

        <div className="py-1">
          <Toggle
            checked={settings.unmute}
            onChange={(unmute) => onChange({ ...settings, unmute })}
            label="Start with sound"
            hint="Browsers require muted autoplay, so this persists after your first unmute."
          />
        </div>

        <div className="space-y-2 pt-3">
          <button
            type="button"
            onClick={onClearHistory}
            className="flex w-full items-center justify-between rounded-lg bg-white/5 px-3 py-2.5 text-sm text-white/80 hover:bg-white/10"
          >
            <span>Reset feed history</span>
            <span className="text-xs text-white/40">show seen posts again</span>
          </button>

          <button
            type="button"
            onClick={onClearSaved}
            disabled={savedCount === 0}
            className="flex w-full items-center justify-between rounded-lg bg-white/5 px-3 py-2.5 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40"
          >
            <span className="flex items-center gap-2">
              <IconTrash className="h-4 w-4" />
              Clear saved
            </span>
            <span className="text-xs text-white/40">{savedCount} items</span>
          </button>
        </div>

        <p className="pt-3 text-[11px] leading-relaxed text-white/30">
          Media is served by cdn.donmai.us. This app stores only your saved list, settings and view
          history in this browser.
        </p>
      </div>
    </Sheet>
  )
}
