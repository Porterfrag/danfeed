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
| Settings | Video size cap, start-with-sound, reset history |
| Keyboard | `↑`/`↓` or `j`/`k` scroll · `space` pause · `m` mute · `s` save |

## Tag autocomplete

Typing completes the **last word only**, so `1girl hats` suggests for `hats` and leaves `1girl` intact.
Arrow keys / `Tab` / `Enter` pick a suggestion, `Esc` dismisses it.

The important detail: Danbooru's autocomplete returns both a `label` (`hatsune miku`, spaces) and a
`value` (`hatsune_miku`, underscores). Only `value` is searchable — inserting the label would search
for the wrong thing. The UI shows `label` and inserts `value`.

Suggestions are cached per prefix and debounced at 150 ms, and autocomplete has its own request lane
so typing never queues behind a feed page load.

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
  lib/danbooru.ts     API client, cursor paging, tag autocomplete, URL resolver
  lib/tagQuery.ts     which tags consume a search slot; add/remove helpers
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
```

## Build

```bash
npm run build
npm run preview
```
