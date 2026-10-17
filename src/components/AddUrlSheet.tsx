import { useState } from 'react'
import type { MediaItem } from '../types'
import { BooruError, resolveUrl } from '../lib/danbooru'
import { Sheet } from './Sheet'

interface Props {
  open: boolean
  onClose: () => void
  onAdd: (item: MediaItem) => void
}

const EXAMPLES = [
  'https://danbooru.donmai.us/posts/12395256',
  'https://cdn.donmai.us/original/05/d6/05d65c3258a2d5d1f42fa099fb893ea6.mp4',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
]

export function AddUrlSheet({ open, onClose, onAdd }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)
    try {
      const item = await resolveUrl(value)
      onAdd(item)
      setValue('')
      onClose()
    } catch (caught) {
      setError(caught instanceof BooruError ? caught.message : 'Could not add that link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title="Add a video or image" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          placeholder="Paste a URL…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
          className="h-11 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-white placeholder:text-white/35 focus:border-white/35 focus:outline-none"
        />

        {error && (
          <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-xs leading-relaxed text-rose-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || value.trim().length === 0}
          className="h-11 w-full rounded-xl bg-white text-sm font-semibold text-black disabled:opacity-40"
        >
          {busy ? 'Resolving…' : 'Add to feed'}
        </button>
      </form>

      <div className="mt-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/40">Accepted</p>
        <ul className="space-y-1 text-xs text-white/60">
          <li>• Danbooru post pages — resolved to the real media file</li>
          <li>• Direct files — .mp4 .webm .jpg .png .gif</li>
          <li>• YouTube / Vimeo — played as an embed</li>
        </ul>
      </div>

      <div className="mt-4 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/40">Try one</p>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setValue(example)}
            className="block w-full truncate rounded-lg bg-white/5 px-2.5 py-1.5 text-left font-mono text-2xs text-white/50 hover:bg-white/10 hover:text-white/80"
          >
            {example}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
