import { Sheet } from './Sheet'

/** Key, then what it does. Ordered the way a session tends to use them. */
const SHORTCUTS: Array<[string, string]> = [
  ['↓ ↑  j k', 'Next and previous post'],
  ['Space', 'Play or pause the video'],
  ['s', 'Save the post'],
  ['m', 'Mute or unmute'],
  ['o', 'Open the original source'],
  ['/', 'Jump to the search box'],
  ['h', 'Back to the default feed'],
  ['?', 'This list'],
]

/**
 * The keyboard's own help screen.
 *
 * Shortcuts nobody can find are shortcuts nobody uses, and the list has to live somewhere
 * inside the app rather than in a manual: a phone has no keyboard to press `?` on, and a
 * desktop has no other way to ask.
 */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Keyboard" onClose={onClose}>
      <dl className="flex flex-col">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="flex items-baseline gap-3 rounded-xl px-3 py-2">
            <dt className="min-w-20 shrink-0 font-mono text-xs text-white/90">{keys}</dt>
            <dd className="text-sm text-white/60">{what}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 border-t border-white/10 px-3 pt-3 text-[11px] leading-relaxed text-white/40">
        Shortcuts stay out of the way while the search box has focus or a sheet is open, and
        Escape closes whatever is open. On a slide, hold a tag chip — or right-click it, or press
        Shift+F10 — for the wiki, Danbooru&apos;s own page and a copyable link.
      </p>
    </Sheet>
  )
}
