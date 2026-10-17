import { IconExternal } from './icons'

interface Props {
  /** Identifies the row to a pending copy result. */
  id?: string
  label: string
  /** The URL for rows that leave the app; the row becomes a real link when given. */
  href?: string
  sub?: string
  status?: { id: string; ok: boolean } | null
  /** Runs before the sheet closes itself, for rows that act on the app rather than leaving it. */
  onClick: () => void
}

/**
 * One row in a sheet: a label, the destination spelled out, and either an action or a link.
 *
 * A link rather than a button for anything external, so the browser's own menu offers "open in
 * new tab" and middle-click works — the app runs in a tab like anything else. The little arrow
 * says the row is about to leave before it is tapped, which is also what `target="_blank"`
 * cannot say on a phone.
 */
export function SheetRow({ id, label, href, sub, status, onClick }: Props) {
  const result = id && status?.id === id ? (status.ok ? 'Copied' : 'Could not copy') : null

  const className =
    'flex min-h-11 w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/10 active:bg-white/15'

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-white">{result ?? label}</span>
        {sub && <span className="block truncate text-[11px] text-white/40">{sub}</span>}
      </span>
      {href && <IconExternal className="mt-0.5 h-4 w-4 shrink-0 text-white/30" />}
    </>
  )

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" aria-label={label} onClick={onClick} className={className}>
        {body}
      </a>
    )
  }

  return (
    <button type="button" aria-label={label} onClick={onClick} className={className}>
      {body}
    </button>
  )
}
