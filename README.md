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
| Browsable tags | Every tag on a slide is one tap from a search; `+N` opens the full list |
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

Suggestions belong to the input, not to the search text — text also arrives in the box from outside
it (tapping a tag chip on a slide, resetting to the default feed), and that must not fire a request
or drop the suggestion panel over the feed the user is browsing. `TagSearch` tracks the last value
that actually came out of the input and only completes for those. The visible symptom of getting
this wrong: tap a tag on a slide and a ~256px suggestion panel unfolds over the top of the feed,
hiding the very thing you just searched for.

Focusing the box on its own does not summon the panel either; it opens when you type.

## Browsing tags

Every slide ends in two browsable rows. The first carries the **artist** who drew it, the
**character** depicted and the **series** it belongs to, each with a coloured dot. The second
carries the general tags as `#pills`. Tapping any of them searches that exact tag, so the feed
becomes everything else with that artist, character, series or tag.

Whatever the rows cannot fit collapses into a `+N` button, and that opens **every** tag on the post
in a sheet, grouped by family. This matters more than it sounds: across 40 recent safe posts the
median post carries **27 general tags**, and **none of the 40** fit in five chips. About 24 tags per
post were previously unreachable.

The chip is a real search, not a hidden mode: the tag lands in the search box, where it stays
visible, editable and clearable, and the *danfeed* logo still returns to the default feed.

Colours are Danbooru's own taxonomy — artist red, character green, series purple, general blue, meta
yellow. All five families live in `lib/tagCategories.ts`, shared by the slide row and the sheet so
the two can never disagree about what a category is called or which tags belong to it.

### Meta tags are kept out of the row

`highres` covers 8.3M posts, `commentary_request` is a moderation flag, and `bad_id` means the post's
ID is wrong. They are flags rather than content — and because `tag_string` is returned
alphabetically, they were landing in the visible five (`absurdres` sorts before `ahoge`). They are
subtracted from the row and left in the sheet, which needs `tag_string_meta` in the payload: a median
of three short tags.

### The pills are small, so their targets are not

The general pills are about 25px tall, well under a comfortable touch target, so each grows its hit
area 4px on every side with a pseudo-element — exactly the row gap, so neighbouring targets meet
without overlapping. That is roughly 33px of target rather than 44, and the sheet is the comfortable
way in.

### Six things that are easy to get wrong

- **Display is not the same as the search.** A chip reads `narita taishin (umamusume)` but searches
  `narita_taishin_(umamusume)`. This is Danbooru's own label/value split, the same rule the
  autocomplete follows: underscores are read as spaces for humans, but only the underscored form
  matches anything.
- **General is derived, not fetched.** `tag_string` contains every category but is not split, so the
  four known families are subtracted from it and whatever is left is general. Deriving it means a
  category Danbooru adds later surfaces as a general tag instead of vanishing from the UI.
- **The caps are per category, not for the row as a whole.** Group pictures routinely carry several
  characters, and one shared cap would push the series off the slide entirely — which is the tag
  most likely to identify the work. Each family is capped separately (2 artists, 2 characters,
  1 series, 5 general) and any remainder collapses into `+N`.
- **Meta counts towards `+N` even though the row never shows it.** Otherwise a post with three
  general tags and two meta ones would have nothing hidden, so no `+N`, and no way into the sheet at
  all. Both `+N` badges open the same sheet, so neither row is a dead end.
- **Tapping a tag resets the filter chip to All.** An active *Videos* or *Top* filter would otherwise
  silently return nothing for an artist who only posts stills, which reads as a bug rather than as a
  filter.
- **Tags are ordinary tags.** One costs one search slot, and the default `rating:` is free, so a tap
  composes with the rating filter without pushing a search over the limit.

The category fields (`tag_string_artist`, `tag_string_character`, `tag_string_copyright`,
`tag_string_meta`) are part of the trimmed `only=` payload. Because they are newer than some saved
items, a saved post has no `artists`, `characters`, `copyrights` or `metaTags` array at all; they are
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
  lib/tagCategories.ts the five tag families, their colours, and which tags are in each
  lib/tagInput.ts     which word is being typed; how to apply a suggestion
  lib/store.ts        localStorage: saved / settings
  lib/useZoom.ts      pinch + double-tap zoom for still images
  hooks/useFeed.ts    pagination, dedupe, session history, limit guard, errors
  components/
    Feed.tsx            snap scroller, IntersectionObserver, header, chips
    TagSearch.tsx       combobox with tag suggestions
    TagLimitNotice.tsx  "too many tags" panel
    PostView.tsx        per-slide renderer + overlays + gestures
    TagsSheet.tsx       every tag on a post, grouped by family
    Sheet.tsx           shared bottom-sheet wrapper
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
