<img width="2752" height="1649" alt="Danfeed Banner (1)" src="https://github.com/user-attachments/assets/8ad04283-5ea8-4349-a030-1fcf9ca909e5" />



# danfeed

A TikTok-style vertical feed for Danbooru — swipe through photos, videos, GIFs and ugoira, search by tag, or paste your own URL.

Pure client-side: no backend, no accounts, no build server. Everything it needs is `danbooru.donmai.us` + `cdn.donmai.us`.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Tests

```bash
npm run verify                    # lint + build + every end-to-end suite
npm run test:e2e                  # the suites alone (builds first)
npm run test:e2e -- tags rating   # a subset, reusing the current dist
npm run shots                     # PNGs of the UI in tests/__shots__ (gitignored)
```

The suites in `tests/` drive the production build in headless Chrome and speak CDP directly — no
test runner, no dependencies. They cannot use the live API (some networks DNS-block `*.donmai.us`,
and Cloudflare fingerprints headless Chrome), so every request is answered from a fixture. A Chrome,
Chromium or Edge binary is required; `CHROME_PATH` points at it when it is not in the usual place.
`tests/run.mjs` gives each suite its own browser with a throwaway profile, and prints each built
file's size and short SHA-256. Those fingerprints identify this build, not the hosted one: a host
that compiles from git produces its own hashes, so compare sizes rather than hashes against a
deployment.

| Suite | Covers |
| --- | --- |
| `tests/tags.mjs` | the general tag row, and the all-tags sheet behind `+N` |
| `tests/entities.mjs` | artist / character / series chips: caps, de-duplication, exact searches |
| `tests/rating.mjs` | the tag string that actually goes on the wire at each rating level |
| `tests/search-panel.mjs` | the suggestion panel must stay out of the feed |
| `tests/history.mjs` | recent searches: what is remembered, and what stays quiet |
| `tests/backup.mjs` | exporting a backup file, and merging one back in |
| `tests/share.mjs` | share links, `?q=` links, and the preview metadata crawlers read |
| `tests/keyboard.mjs` | every shortcut, where it must stay quiet, and the sheets it opens |
| `tests/tag-actions.mjs` | holding a chip: the sheet, the click it swallows, stacked sheets, Escape |
| `tests/retry.mjs` | which failures are repeated and which are final, for the API and for media |
| `tests/pwa.mjs` | the service worker, the shell it caches, and opening offline |
| `tests/a11y.mjs` | reduced motion, the live region, the dialog contract, the feed's structure |

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
| Tag actions | Hold a tag chip — or right-click it — to search it here, open it on Danbooru, read its wiki, or copy the search link |
| Rating | Safe by default; Moderate/Everything opt-in per browser |
| Recent searches | An empty search box offers your last few searches; tap one to run it again |
| Backup | Saved posts, recent searches and settings to one JSON file — and back in, merged |
| Share | Copy the post link, the media link, or a `?q=` link that opens this search elsewhere |
| Home | Tap the **danfeed** logo to reset: default feed, cleared search, back to top |
| Settings | Content rating, video size cap, start-with-sound, reset history |
| Keyboard | `↑`/`↓` or `j`/`k` scroll · `space` pause · `m` mute · `s` save — `?` lists the rest |
| Failures | A dropped connection or a 5xx is retried twice before the error card; a 4xx is final |
| Offline shell | A service worker keeps the app itself cached, so it opens without a network (the API and the media still need one) |
| Motion | `prefers-reduced-motion` stops the autoplay, the gliding scroll and the sheet animations |

## Keyboard

| Key | |
| --- | --- |
| `↓` `j` | Next post |
| `↑` `k` | Previous post |
| `space` | Play or pause the video |
| `s` | Save the post |
| `m` | Mute or unmute |
| `o` | Open the original source |
| `/` | Jump to the search box |
| `h` | Back to the default feed |
| `?` | This list, in the app |

Shortcuts stay out of the way while the search box has focus or a sheet is open, and `Escape`
closes whatever is in front.

## Licence

The code is MIT; the artwork — the mascot, its crops and the app icons — is all rights reserved.
`LICENSE` names exactly which files that covers.

danfeed is an unofficial client of Danbooru's public API and is not affiliated with it. No media is
hosted here: every image and video is loaded from `cdn.donmai.us` and belongs to the artist or
uploader who posted it.


