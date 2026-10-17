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


