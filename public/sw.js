/**
 * danfeed's service worker: the shell, and nothing else.
 *
 * Hand-written rather than generated, because what this app needs from a worker is small and
 * specific enough that the rules are easier to read than to configure:
 *
 * - Navigation: network first, cache as fallback. A deploy is picked up on the next visit, and
 *   an offline visit still gets the app instead of the browser's error page.
 * - `/assets/*` and the handful of shell files: cache first. The build content-hashes everything
 *   under `/assets/`, so a cache hit is always the right bytes, and nothing there changes under a
 *   name that is already in use.
 * - Everything else is left alone. The Danbooru API, the media CDN and its range requests are
 *   not cached here: API answers must be live, and an intercepted video stream breaks seeking.
 *   Only same-origin requests are considered at all.
 *
 * The app's data — saved posts, history, settings — lives in localStorage, which the worker
 * cannot see and does not need to; the shell it caches is the same empty app the first visit got.
 */
const CACHE = 'danfeed-shell-v1'

/** Files that are part of the app itself, alongside the hashed bundle. */
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precache()
      // Take over as soon as the browser lets us: waiting would leave this visit running the old
      // rules, and the page can be reloaded at any moment.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Only ever one cache: a version bump should not leave the last one's files behind.
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request))
    return
  }

  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith(cached(request))
  }
})

/**
 * Fill the cache before the first visit to it can need it.
 *
 * The order matters: the shell first, because it names the bundle, and then the bundle, because
 * it names the images it imports. A first visit that ends offline is the case this exists for,
 * and it is the visit during which nothing has been fetched *through* the worker yet — every
 * request the page makes is made before the worker exists to see it.
 */
async function precache() {
  const cache = await caches.open(CACHE)
  // Individually, so one missing icon cannot fail the whole install.
  await Promise.all(SHELL.map((path) => cache.add(path).catch(() => undefined)))

  try {
    const paths = assetPaths(await (await fetch('/index.html')).text())
    for (const script of [...paths].filter((path) => path.endsWith('.js'))) {
      for (const path of assetPaths(await (await fetch(script)).text())) paths.add(path)
    }
    await Promise.all([...paths].map((path) => cache.add(path).catch(() => undefined)))
  } catch {
    /* Offline partway through: what was reachable is cached, and the rest fills in as it is used. */
  }
}

/** Network first, with the shell — and the old shell — as the fallbacks. */
async function navigate(request) {
  const cache = await caches.open(CACHE)

  try {
    const response = await fetch(request)
    if (response.ok) {
      const html = await response.clone().text()
      await cache.put('/', response.clone())
      await prune(cache, html)
    }
    return response
  } catch {
    // Any URL under the scope is the same app, and the query in the address bar is read by the
    // app rather than the server, so a shared `?q=` link works from the cache too.
    return (await cache.match('/')) ?? (await cache.match('/index.html')) ?? Response.error()
  }
}

/** Cache first: these names only ever mean one file each. */
async function cached(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit

  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

/**
 * Every `/assets/...` path a file names, whether that file is HTML or the bundle itself.
 *
 * Vite writes them as string literals, template literals, and `url()` in CSS — the three ways a
 * path could be quoted, which is what the delimiters in the pattern are for.
 */
function assetPaths(text) {
  const paths = new Set()
  for (const match of text.matchAll(/["'(`]([^"'`)]*\/assets\/[^"'`)]+)["'`)]/g)) paths.add(match[1])
  return paths
}

/**
 * Drop the previous build's bundle.
 *
 * The fresh index.html names the files this build needs; anything else under `/assets/` is the
 * deploy before it, and without this the cache would grow by a whole bundle every time the app
 * shipped. Called after the new shell is stored, so a failure cannot leave the cache empty.
 */
async function prune(cache, html) {
  const keep = new Set(['/', '/index.html', ...assetPaths(html)])
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname
    if (path.startsWith('/assets/') && !keep.has(path)) await cache.delete(request)
  }
}
