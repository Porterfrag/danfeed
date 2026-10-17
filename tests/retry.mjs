/**
 * Failure handling: what the app retries on its own, what it refuses to, and what it says.
 *
 * The two halves are separate on purpose. A repeated GET is free, so 5xx and dropped connections
 * are ridden out with a short backoff; a 4xx is the same answer every time, so it is not repeated
 * and the message goes straight to the error card. Media gets one quiet retry of its own, because
 * the CDN including its failures in the browser cache is a real thing.
 *
 * Each section installs its own routes, so the failure it stages is the failure it is asserting
 * about. Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
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

const CDP_PORT = Number(process.env.CDP_PORT || 9336)
const APP = process.env.APP_URL || 'http://localhost:4173/'
const MEDIA = 'https://cdn.donmai.us/sample/aa/bb/930901.jpg'

const POSTS = [
  {
    id: 930901,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 250000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/930901.jpg',
    large_file_url: MEDIA,
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/930901.jpg',
    tag_string: '1girl solo',
    tag_count: 2,
    is_animated: false,
    media_asset: { id: 1, variants: [] },
  },
]

const bodyText = `document.body.innerText`
/** The slide's own image: the blurred preview behind it is a separate request. */
const mediaWidth = `document.querySelector('[data-slide] img[alt]:not([alt=""])')?.naturalWidth ?? 0`

/** Poll a page-side expression until it is truthy. */
async function waitFor(c, expression, { tries = 60 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await c.evalJS(expression)) return true
    await sleep(150)
  }
  return false
}

async function main() {
  const c = await connectToPage(CDP_PORT)
  const pageErrors = watchPageErrors(c)
  let interceptor = null

  /** Fresh routes for this section; the previous section's answers stop being served. */
  async function restub(routes) {
    if (interceptor) c.off(interceptor)
    interceptor = await stubApi(c, routes)
  }

  const AUTOCOMPLETE = { match: 'donmai.us/autocomplete.json', json: [] }
  // Ahead of the failing route on purpose: every post also loads its blurred preview, and that
  // request must not spend the one failure that is meant for the image itself.
  const PREVIEW = { match: '180x180', image: PNG, contentLength: true }

  console.log('\n=== 1. a 5xx that clears up is ridden out ===')
  const transient = []
  await restub([
    { match: 'donmai.us/posts.json', json: POSTS, record: transient, fail: 2, status: 503 },
    AUTOCOMPLETE,
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])
  const startedAt = Date.now()
  await c.send('Page.navigate', { url: APP })
  check('the feed arrives despite two bad answers', (await waitForSlides(c, 1)) > 0)
  check('exactly three asks were made', transient.length === 3, String(transient.length))
  check('and the backoff was waited out', Date.now() - startedAt > 1400, `${Date.now() - startedAt} ms`)
  check('no error was put on screen', !(await c.evalJS(bodyText)).includes('having a moment'))

  console.log('\n=== 2. a 5xx that never clears up gives up ===')
  const persistent = []
  await restub([
    { match: 'donmai.us/posts.json', json: POSTS, record: persistent, fail: 9, status: 500 },
    AUTOCOMPLETE,
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])
  await c.send('Page.navigate', { url: APP })
  check('the failure reaches the screen', await waitFor(c, `document.querySelector('[role="alert"]') !== null`))
  check('it stopped after three asks', persistent.length === 3, String(persistent.length))
  const persistentText = await c.evalJS(bodyText)
  check('and says how many times it tried', persistentText.includes('Tried 3 times.'), persistentText.slice(0, 160))
  check(
    'with the message the API gave it',
    persistentText.includes('Danbooru is having a moment.'),
    persistentText.slice(0, 160),
  )

  console.log('\n=== 3. a 4xx is not repeated ===')
  const rejected = []
  await restub([
    {
      match: 'donmai.us/posts.json',
      json: { error: 'Invalid tag' },
      record: rejected,
      status: 422,
    },
    AUTOCOMPLETE,
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])
  await c.send('Page.navigate', { url: APP })
  const rejectedText = await waitFor(c, `document.body.innerText.includes('HTTP 422')`)
    ? await c.evalJS(bodyText)
    : ''
  check('the failure reaches the screen', rejectedText.includes('HTTP 422'), rejectedText.slice(0, 160))
  await sleep(1600)
  check('it was asked once and no more', rejected.length === 1, String(rejected.length))
  check('and says nothing about trying again', !rejectedText.includes('Tried'), rejectedText.slice(0, 160))

  console.log('\n=== 4. a dropped connection is retried ===')
  const dropped = []
  await restub([
    { match: 'donmai.us/posts.json', json: POSTS, record: dropped, failNetwork: 2 },
    AUTOCOMPLETE,
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])
  await c.send('Page.navigate', { url: APP })
  check('the feed arrives after the network comes back', (await waitForSlides(c, 1)) > 0)
  check('three asks were made', dropped.length === 3, String(dropped.length))

  console.log('\n=== 5. media that fails once is asked for again ===')
  const mediaCalls = []
  await restub([
    { match: 'donmai.us/posts.json', json: POSTS },
    AUTOCOMPLETE,
    PREVIEW,
    { match: 'cdn.donmai.us', image: PNG, contentLength: true, record: mediaCalls, fail: 1, status: 502 },
  ])
  await c.send('Page.navigate', { url: APP })
  await waitForSlides(c, 1)
  check('the image ends up on screen', await waitFor(c, `${mediaWidth} > 0`))
  check('two asks were made', mediaCalls.length === 2, JSON.stringify(mediaCalls))
  check(
    'the retry asked on a URL the browser had not seen',
    mediaCalls.some((url) => url.includes('df-retry=1')),
    JSON.stringify(mediaCalls),
  )
  check('the failure card never appeared', !(await c.evalJS(bodyText)).includes('could not be loaded'))

  console.log('\n=== 6. media that fails twice offers a way back ===')
  const stubborn = []
  await restub([
    { match: 'donmai.us/posts.json', json: POSTS },
    AUTOCOMPLETE,
    PREVIEW,
    { match: 'cdn.donmai.us', image: PNG, contentLength: true, record: stubborn, fail: 2, status: 502 },
  ])
  await c.send('Page.navigate', { url: APP })
  await waitForSlides(c, 1)
  check('the card appears after the second failure', await waitFor(c, `document.body.innerText.includes('could not be loaded')`))
  check('two asks had been made', stubborn.length === 2, JSON.stringify(stubborn))
  const triedAgain = await c.evalJS(`(() => {
    const button = Array.from(document.querySelectorAll('[data-slide] button'))
      .find((b) => b.textContent.trim() === 'Try again')
    if (!button) return 'missing'
    button.click()
    return 'clicked'
  })()`)
  check('the card offers a button', triedAgain === 'clicked', triedAgain)
  check('and the third ask loads the image', await waitFor(c, `${mediaWidth} > 0`))
  check('the card is gone', !(await c.evalJS(bodyText)).includes('could not be loaded'))
  check(
    'the third ask was on a new URL again',
    stubborn.some((url) => url.includes('df-retry=2')),
    JSON.stringify(stubborn),
  )

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  if (interceptor) c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
