/**
 * The offline shell: the worker, what it keeps, and opening the app with no network.
 *
 * What is being tested is the app's own worker rather than a framework's: the suite asserts that
 * the file served at `/sw.js` *is* the worker (the body has to say so — the host falls back to
 * index.html for anything it does not know), that it takes control and precaches the built bundle
 * on the *first* visit, that it leaves the API and the CDN alone, and that a visit with the
 * network switched off still boots the app from the cache.
 *
 * The API stays stubbed while offline. The worker is not supposed to answer for Danbooru, and the
 * offline assertion is about the shell — the script that has to come out of the cache for React
 * to render at all — not about what the feed then has to say.
 *
 * Run by tests/run.mjs against the production build.
 */
import {
  check,
  connectToPage,
  PNG,
  report,
  sleep,
  stubApi,
  waitForSlides,
  watchPageErrors,
} from './lib/cdp.mjs'

const CDP_PORT = Number(process.env.CDP_PORT || 9337)
const APP = process.env.APP_URL || 'http://localhost:4173/'
const ORIGIN = new URL(APP).origin

const POSTS = [
  {
    id: 940901,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 240000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/940901.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/aa/bb/940901.jpg',
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/940901.jpg',
    tag_string: '1girl solo',
    tag_count: 2,
    is_animated: false,
    media_asset: { id: 1, variants: [] },
  },
]

const cachedPaths = `(async () => {
  const cache = await caches.open('danfeed-shell-v1')
  return (await cache.keys()).map((request) => request.url)
})()`

async function waitFor(c, expression, { tries = 60 } = {}) {
  for (let i = 0; i < tries; i++) {
    const value = await c.evalJS(expression)
    if (value) return value
    await sleep(150)
  }
  return null
}

async function main() {
  const c = await connectToPage(CDP_PORT)
  const pageErrors = watchPageErrors(c)

  const interceptor = await stubApi(c, [
    { match: 'donmai.us/posts.json', json: POSTS },
    { match: 'donmai.us/autocomplete.json', json: [] },
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])

  await c.send('Page.navigate', { url: APP })
  check('the app rendered', (await waitForSlides(c, 1)) > 0)
  console.log('\n=== 1. the worker is served, and it is ours ===')
  const worker = await c.evalJS(`(async () => {
    const response = await fetch('/sw.js', { cache: 'no-store' })
    return { ok: response.ok, type: response.headers.get('content-type') ?? '', text: await response.text() }
  })()`)
  check('sw.js is served', worker.ok, JSON.stringify(worker).slice(0, 120))
  check('with the cache name this worker uses', worker.text.includes('danfeed-shell-v1'), worker.text.slice(0, 120))
  check('and sent as script', worker.type.includes('javascript'), worker.type)

  const manifest = await c.evalJS(`fetch('/manifest.webmanifest').then((r) => r.json())`)
  check('the manifest claims the app', manifest.name === 'danfeed' && manifest.id === '/', JSON.stringify(manifest).slice(0, 120))

  console.log('\n=== 2. it takes control ===')
  const controller = await waitFor(
    c,
    `navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js') ?? false`,
  )
  check('the page is controlled by the worker', controller === true)
  check(
    'and the registration is there',
    (await c.evalJS(`navigator.serviceWorker.getRegistration().then((r) => !!r)`)) === true,
  )

  console.log('\n=== 3. the cache holds the whole shell ===')
  const cached = await c.evalJS(cachedPaths)
  const paths = cached.map((url) => new URL(url).pathname)
  check('the cache exists', (await c.evalJS(`caches.keys()`)).includes('danfeed-shell-v1'))
  check('the page itself is cached', paths.includes('/') && paths.includes('/index.html'), JSON.stringify(paths))
  check('so is the manifest and its icons', paths.includes('/manifest.webmanifest') && paths.includes('/icon-192.png'))
  check('and the built script', paths.some((path) => /^\/assets\/index-.*\.js$/.test(path)), JSON.stringify(paths))
  check(
    'the images the script imports came along too',
    paths.some((path) => path.includes('logo-mark')),
    JSON.stringify(paths),
  )
  check(
    'the API and the media CDN were left out of it',
    cached.every((url) => url.startsWith(ORIGIN)),
    JSON.stringify(cached),
  )

  console.log('\n=== 4. a second visit still works ===')
  await c.send('Page.navigate', { url: APP })
  check('the feed loads with the worker in charge', (await waitForSlides(c, 1)) > 0)
  check('and the page is the one it served', (await c.evalJS(`document.title`)) === 'danfeed')

  console.log('\n=== 5. the app opens with no network ===')
  await c.send('Network.enable')
  await c.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  // Proof that the emulation is doing something, and that the worker is not what answers this:
  // /robots.txt is neither a navigation nor a cached asset, so the worker lets it through to a
  // network that is not there. Online it would be a 404 — a response, not a rejection.
  check(
    'the network really is off',
    (await c.evalJS(`fetch('/robots.txt').then(() => 'answered').catch(() => 'offline')`)) === 'offline',
  )
  await c.send('Page.navigate', { url: APP })
  const booted = await waitFor(c, `document.querySelector('[role="feed"]') !== null`)
  check('the shell came out of the cache and ran', booted === true)
  check('the document is what the app sets it to', (await c.evalJS(`document.title`)) === 'danfeed')
  check(
    'and the header is there, not the browser’s error page',
    (await c.evalJS(`document.body.innerText.includes('danfeed')`)) === true,
    (await c.evalJS(`document.body.innerText`)).slice(0, 120),
  )
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  await c.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
