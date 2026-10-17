import type { Settings } from '../lib/store'
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
        <div className="pb-3">
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
