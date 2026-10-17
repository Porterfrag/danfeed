import type { ReactNode } from 'react'
import { IconX } from './icons'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export function Sheet({ open, title, onClose, children }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="df-fade-in absolute inset-0 cursor-default bg-black/65 backdrop-blur-sm"
      />
      <div className="df-fade-up safe-b relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/10 bg-neutral-900 p-4 pb-6 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
