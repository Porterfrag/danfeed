import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { IconX } from './icons'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/** Everything inside the panel the keyboard can reach, in tab order. */
function focusablesIn(panel: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter(
    // `offsetParent` is null for anything `display:none` — the restore-file input in Settings is
    // one of those, and Tab walks straight past it.
    (element) => element.offsetParent !== null,
  )
}

/**
 * The bottom sheet every overlay is built from.
 *
 * Focus is moved into the panel when it opens, kept inside it while it is open, and put back where
 * it was when it closes. Without the first, Tab from the trigger walks into the slides behind the
 * sheet, which the user cannot see; without the last, the sheet closes and the caret is nowhere.
 * The dimmed app behind is taken out of the tab order by the caller.
 */
export function Sheet({ open, title, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return

    const returnTo = document.activeElement
    panelRef.current?.focus()

    return () => {
      // `focus` can be gone by now if the trigger was inside something that unmounted with us.
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus()
    }
  }, [open])

  /**
   * Keep Tab inside.
   *
   * `aria-modal` claims the rest of the page is not there, and the caller makes it `inert` — but
   * the browser still ends the sheet's tab order where the document's ends, so tabbing off the
   * last row lands on the browser's own chrome. Wrapping it here is what makes the claim true.
   */
  function onPanelKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return

    const panel = panelRef.current
    if (!panel) return

    const focusables = focusablesIn(panel)
    if (focusables.length === 0) return

    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  useEffect(() => {
    if (!open) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return

      // Sheets can stack (the all-tags list opens the tag's own actions). Only the one in front
      // answers — closing both would throw away the place the user was in for one keypress.
      const dialogs = document.querySelectorAll('[role="dialog"]')
      if (dialogs.length > 0 && dialogs[dialogs.length - 1] !== panelRef.current) return

      e.preventDefault()
      onClose()
    }

    // On the window rather than the panel: Escape should close the sheet wherever focus is, which
    // after a click on the panel's own text is the panel rather than any control in it.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="df-fade-in absolute inset-0 cursor-default bg-black/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="df-fade-up scroll-quiet safe-b relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/10 bg-neutral-900 p-4 pb-6 shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          >
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
