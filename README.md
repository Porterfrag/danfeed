# danfeed

A TikTok-style vertical feed for Danbooru — swipe through photos, videos, GIFs and ugoira, search by tag, or paste your own URL.

Pure client-side: no backend, no accounts, no build server. Everything it needs is `danbooru.donmai.us` + `cdn.donmai.us`.

## Run

```bash
npm install
npm run dev
```

## Network requirement

Danbooru must be reachable **from your browser**. Some ISPs (and some DNS resolvers) redirect
`*.donmai.us` to a block page. The app detects that failure mode and shows a diagnostic screen
instead of a blank feed — it cannot work around it for you.

Fix it with Secure DNS or a VPN:

- Chrome / Edge — Settings → Privacy and security → Use secure DNS → Cloudflare
- Or any VPN / DNS resolver that returns the real Cloudflare IPs

## What it does

| Feature | Notes |
| --- | --- |
| Mixed feed | Photos, videos, GIFs and ugoira in one snap-scroll feed |
| Search | **Autocomplete** on the word being typed (`chun` → `chun-li`) |
| Tag limit | Enforced locally, with a remove-tag panel — the 422 is never sent |
| Filter chips | All · Videos · Photos · Animated · Top |
| Add by URL | Danbooru post page, direct media file, or YouTube/Vimeo embed |
| Saved | Stored in `localStorage`; double-tap a video or use the rail button |
| Artist | Tap the artist on any slide to load everything else by them |
| Rating | Safe by default; Moderate/Everything opt-in per browser (see below) |
| Home | Tap the **danfeed** logo to reset: default feed, cleared search, back to top |
| Settings | Content rating, video size cap, start-with-sound, reset history |
| Keyboard | `↑`/`↓` or `j`/`k` scroll · `space` pause · `m` mute · `s` save |

## Tag autocomplete

Typing completes the **last word only**, so `1girl hats` suggests for `hats` and leaves `1girl` intact.
Arrow keys / `Tab` / `Enter` pick a suggestion, `Esc` dismisses it.

The important detail: Danbooru's autocomplete returns both a `label` (`hatsune miku`, spaces) and a
`value` (`hatsune_miku`, underscores). Only `value` is searchable — inserting the label would search
for the wrong thing. The UI shows `label` and inserts `value`.

Suggestions are cached per prefix and debounced at 150 ms, and autocomplete has its own request lane
so typing never queues behind a feed page load.

## Browsing an artist

Every slide with an artist tag shows a chip for them, above the tag row. Tapping it searches that
artist's work, so the feed becomes "everything else by this person".

The chip is a real search, not a hidden mode: the artist tag lands in the search box, where it stays
visible, editable and clearable, and the *danfeed* logo still returns to the default feed.

Three details that are easy to get wrong:

- **Display is not the same as the search.** The chip reads `anna (k0130)` but searches
  `anna_(k0130)`. This is Danbooru's own label/value split, the same rule the autocomplete follows:
  underscores are read as spaces for humans, but only the underscored form matches anything.
- **The artist tag is already inside `tag_string`.** Verified against the live API — every post's
  `tag_string` includes its artist tags — so rendering `tags` as-is would show the artist twice. The
  artist tags are filtered out of the `#tag` row and given the chip instead.
- **Tapping an artist resets the filter chip to All.** An active *Videos* or *Top* filter would
  otherwise silently return nothing for an artist who only posts stills, which reads as a bug rather
  than as a filter.

Collaborations show up to three chips and count the rest (`+1`), and a post with no artist tag simply
shows no chip. Artist tags are ordinary tags, so one costs one search slot — the default `rating:` is
free and composes with it.

Artist data comes from `tag_string_artist`, which was added to the trimmed `only=` payload. Because
that field is new, saved items written by earlier builds have no `artists` array at all; they are
repaired on load in `lib/store.ts` rather than guarded at every render, so an old saved post cannot
crash the feed when it is played.

## The 2-tag limit

Danbooru rejects searches with more than two tags:

```
422 PostQuery::TagLimitError
"You cannot search for more than 2 tags at a time."
```

This applies to anonymous **and** regular accounts — only Gold and above raise it. Rather than
letting that error surface, the app classifies the query locally and refuses to send a doomed
request, showing a panel with each tag and a remove button.

Classification is not simply "count the words". Some metatags are free, verified against the live API:

| Counts toward the limit | Free |
| --- | --- |
| plain tags (`ass`, `chun-li`) | `rating:` `score:` `id:` `date:` |
| negations (`-animated`) | `width:` `height:` `filetype:` |
| `order:` `pool:` | `favcount:` `status:` `age:` `parent:` |

Two consequences worth knowing:

- **`id:` is free**, which is what makes `id:<cursor` pagination work — appending it never pushes a
  search over the limit.
- **`score:` is free**, so the *Top* filter uses `score:>200` instead of `order:score`. That is not
  only about the limit: `order:score` over the whole database times out with `500 QueryCanceled`.
  *Top* therefore leaves both tag slots available, while the other filters consume one.

`verify-limit.ts` cross-checks this table against the live API with `npm run verify:limit`,
and refuses to report success unless it actually reached the server.

## Content rating

The feed opens on `rating:general` so a shared link shows safe content by default. Settings offers
three levels, stored per-browser in `localStorage`:

| Level | Tag sent |
| --- | --- |
| Safe *(default)* | `rating:general` |
| Moderate | `rating:general,sensitive` |
| Everything | *(nothing)* |

A comma inside the value is an OR, so Moderate returns both ratings rather than neither. Everything
emits no rating tag at all, which is equivalent to listing all four — every post already carries one.

`rating:` is a free metatag, so the default filter does **not** eat a search slot. Verified: the
full home query is just `rating:general`, and `rating:general video chun-li` still returns results
while `rating:general 1girl solo chun-li` correctly trips the limit. A whole feed of safe content
therefore costs nothing in search power.

**Typing your own rating wins.** If the query contains any `rating:` token — including a negation
like `-rating:explicit` — the app drops its own default. This is not a nicety, it is required:
Danbooru ANDs repeated metatags, so `rating:general rating:explicit` matches **zero** posts rather
than falling through to explicit. Searching `rating:explicit` is the escape hatch for anyone who
wants one specific rating, and it stays within the tag limit because the metatag is free.

Two smaller details:

- The gear icon carries an amber dot whenever the feed is allowed past general, so an unfiltered
  feed is never a surprise after the setting was forgotten.
- A hand-edited `localStorage` value that is not one of the three levels is coerced back to
  `general`, so an unknown value cannot leak the literal string `undefined` into the search.

## How media is resolved

Danbooru exposes a `media_asset.variants` array per post, which drives the whole renderer:

| `file_ext` | Kind | Source used | Fit |
| --- | --- | --- | --- |
| `jpg` `png` `webp` | photo | `large_file_url` (850px sample) | contain |
| `mp4` `webm` | video | `file_url` (original) | contain |
| `gif` | gif | `file_url` | contain |
| `zip` (ugoira) | ugoira | `sample` variant webm | contain |

Two things worth knowing:

- **Originals only.** Danbooru ships no transcodes, so videos are whatever the uploader posted —
  sometimes 9 MB for 20 seconds. The "skip videos larger than N MB" setting gates big files behind
  a tap so scrolling never silently burns data.
- **Ugoira is a zip of frames.** Rather than decoding frames in JS, the app plays the `sample`
  webm variant through the same `<video>` path as mp4.

Photos use the 850px sample, never the original (which can be 20 MB+). The original is only loaded
if you zoom.

## Layout

```
src/
  lib/danbooru.ts     API client, cursor paging, tag autocomplete, URL resolver, tag labels
  lib/tagQuery.ts     slot classification, rating levels, tag assembly
  lib/tagInput.ts     which word is being typed; how to apply a suggestion
  lib/store.ts        localStorage: saved / settings
  lib/useZoom.ts      pinch + double-tap zoom for still images
  hooks/useFeed.ts    pagination, dedupe, session history, limit guard, errors
  components/
    Feed.tsx            snap scroller, IntersectionObserver, header, chips
    TagSearch.tsx       combobox with tag suggestions
    TagLimitNotice.tsx  "too many tags" panel
    PostView.tsx        per-slide renderer + overlays + gestures
    AddUrlSheet.tsx     paste-a-URL flow
    SavedSheet.tsx      saved list
    SettingsSheet.tsx   settings
    Diagnostic.tsx      "can't reach Danbooru" screen

public/
  _headers              Cloudflare Pages cache + security headers
```

## Build

```bash
npm run build
npm run preview
```

## Deploy

The app is a static bundle: no server, no database, no API keys, no environment variables. The
build output in `dist/` can be served by anything.

### Cloudflare Pages (recommended)

Chosen because it is the only major free host with no bandwidth cap, and because the app barely uses
any anyway — every byte of media comes from `cdn.donmai.us`, so a visitor only downloads the ~300 KB
bundle. There are no repo-side settings needed: Pages detects Vite.

Connect the repository in the Cloudflare dashboard, then:

| Setting | Value |
| --- | --- |
| Framework preset | `Vite` |
| Build command | `npm run build` |
| Build output directory | `dist` |

Every push to `main` then redeploys automatically. `public/_headers` ships with the build and gives
hashed `/assets/*` a one-year immutable cache while keeping `index.html` revalidating, so a deploy is
picked up immediately instead of behind a stale shell.

No `base` is needed because Pages serves from the domain root. It *would* be needed for subpath
hosting such as a GitHub Pages project site (`https://user.github.io/repo/`), where the default
absolute `/assets/...` URLs 404 and the page renders blank. One line fixes it:

```ts
// vite.config.ts
export default defineConfig({ base: '/repo-name/', /* ... */ })
```

There are also no SPA rewrite rules to configure: the app has no router, so every route is `/`.

### Alternatives

Netlify and Vercel work the same way with zero config (root path). GitHub Pages also works but needs
the `base` line above plus a build workflow, and its CDN is slower.

### Testing on a phone before deploying

```bash
npm run build
npm run preview -- --host
```

Open the printed LAN URL on a phone to feel the swipe gestures for real.

### Important caveat for whoever visits the site

Hosting does **not** work around the DNS block described above. The browser fetches
`danbooru.donmai.us` directly and the server is never in the path, so a visitor on a network that
redirects `*.donmai.us` will get the diagnostic screen rather than the feed. Making it work for them
would require a server-side proxy that streams the media too, which is a different architecture and
no longer free.
