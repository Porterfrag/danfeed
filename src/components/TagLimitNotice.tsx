import { TAG_LIMIT } from '../lib/tagQuery'

interface Props {
  tokens: string[]
  filterTokens: string[]
  limit?: number
  onRemove: (token: string) => void
  onClear: () => void
}

/**
 * Danbooru rejects >2 tags with a 422. Rather than showing that error, the feed
 * refuses to send the request and explains which tags to drop.
 */
export function TagLimitNotice({ tokens, filterTokens, limit = TAG_LIMIT, onRemove, onClear }: Props) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white">Too many tags</span>
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-2xs font-medium text-amber-300">
            {tokens.length} / {limit}
          </span>
        </div>

        <p className="text-xs leading-relaxed text-white/50">
          Danbooru only allows {limit} tags per search. Remove one to load the feed.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {tokens.map((token) => {
            const fromFilter = filterTokens.includes(token)
            return (
              <button
                key={token}
                type="button"
                onClick={() => onRemove(token)}
                className="group flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 py-1 pl-2.5 pr-1.5 text-xs text-white/85 transition hover:border-rose-400/40 hover:bg-rose-500/15"
              >
                <span className="font-mono">{token}</span>
                {fromFilter && <span className="text-2xs uppercase text-white/35">filter</span>}
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-white/60 group-hover:bg-rose-500/30 group-hover:text-rose-200">
                  ×
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
        >
          Clear search
        </button>
      </div>
    </div>
  )
}
