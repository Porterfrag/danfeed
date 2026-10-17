import { BooruError } from '../lib/danbooru'
import logoMark from '../assets/logo-mark.jpg'
import { IconAlert, IconRefresh } from './icons'

interface Props {
  error: BooruError
  onRetry: () => void
}

const STEPS = [
  'Turn on Secure DNS in your browser (Chrome: Settings → Privacy → Use secure DNS → Cloudflare).',
  'Or connect through a VPN / different DNS resolver.',
  'Reload this page.',
]

export function Diagnostic({ error, onRetry }: Props) {
  const blocked = error.kind === 'blocked' || error.kind === 'network'

  // `role="alert"`: this replaces the whole feed, and there is nothing else on screen left to
  // explain what happened. Announced, rather than left for a screen reader to stumble into.
  return (
    <div role="alert" className="flex h-full w-full items-center justify-center bg-black px-6">
      <div className="w-full max-w-md">
        {/* The mascot, so the screen is still the app's even when nothing in it worked. */}
        <div className="mb-5 flex items-center gap-2.5">
          <img
            src={logoMark}
            alt=""
            aria-hidden
            draggable={false}
            decoding="async"
            className="h-12 w-12 rounded-full opacity-80 select-none"
          />
          <span className="font-mono text-2xs tracking-widest text-white/40">danfeed</span>
        </div>

        <div className="mb-4 flex items-center gap-2 text-amber-300">
          <IconAlert className="h-5 w-5" />
          <span className="text-sm font-semibold">
            {blocked ? "Can't reach Danbooru" : 'Danbooru error'}
          </span>
        </div>

        <p className="text-sm leading-relaxed text-white/70">{error.message}</p>

        {blocked && (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Likely cause
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/70">
              Some networks redirect <span className="font-mono text-white/90">danbooru.donmai.us</span>{' '}
              to a block page. The app itself cannot work around that — the network has to be fixed.
            </p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-sm text-white/70">
              {STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        <button
          type="button"
          onClick={onRetry}
          className="mt-5 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black"
        >
          <IconRefresh className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  )
}
