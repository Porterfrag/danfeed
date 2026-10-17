/**
 * Sharing: the sheet on a slide, what each link is, and the `?q=` link it produces.
 *
 * The clipboard itself is stubbed (headless Chrome's clipboard needs permissions that vary by
 * version), so what is asserted is the app's half — that each row composes the right URL and
 * hands it over — which is the part that can be wrong. The preview metadata in the served HTML
 * is checked here too: it is what every crawler reads, and nothing else in the suite would notice
 * if it broke.
 *
 * Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
 */
import {
  check,
  connectToPage,
  PNG,
  report,
  setSearchText,
  sleep,
  stubApi,
  waitForSlides,
  watchPageErrors,
} from './lib/cdp.mjs'

const CDP_PORT = Number(process.env.CDP_PORT || 9333)
const APP = process.env.APP_URL || 'http://localhost:4173/'
const ORIGIN = new URL(APP).origin
const POST_ID = 900601
const MEDIA = 'https://cdn.donmai.us/sample/aa/bb/sample-900601.jpg'
const POSTS = [
  {
    id: POST_ID,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 280000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/900601.jpg',
    large_file_url: MEDIA,
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/900601.jpg',
    tag_string: 'chun-li 1girl solo',
    tag_count: 3,
    is_animated: false,
    media_asset: { id: 1, variants: [] },
  },
]

const boxValue = `document.querySelector('[role="combobox"]').value`
const panelOpen = `!!document.getElementById('tag-suggestions')`
const copied = `window.__copied ?? []`
const shareRows = `Array.from(document.querySelectorAll('[aria-label^="Copy"], [aria-label="Share…"]')).map(b => b.getAttribute('aria-label'))`
const meta = (selector) => `document.querySelector('${selector}')?.content ?? ''`

function tagsOf(url) {
  return decodeURIComponent(new URL(url).searchParams.get('tags') ?? '')
}

async function main() {
  const c = await connectToPage(CDP_PORT)
  const autoCalls = []
  const postCalls = []
  const pageErrors = watchPageErrors(c)

  const interceptor = await stubApi(c, [
    { match: 'donmai.us/posts.json', json: POSTS, record: postCalls },
    { match: 'donmai.us/autocomplete.json', json: [], record: autoCalls },
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])

  await c.send('Page.navigate', { url: APP })
  check('app rendered slides from the stubbed API', (await waitForSlides(c, 1)) > 0)
  await sleep(400)

  console.log('\n=== 1. the served page carries preview metadata ===')
  check(
    'og:image is absolute and points at the card',
    (await c.evalJS(meta('meta[property="og:image"]'))) === 'https://danfeed.porterfrag.workers.dev/og.png',
    await c.evalJS(meta('meta[property="og:image"]')),
  )
  check('the card declares its size', (await c.evalJS(meta('meta[property="og:image:width"]'))) === '1200' && (await c.evalJS(meta('meta[property="og:image:height"]'))) === '630')
  check('og:title names the app', (await c.evalJS(meta('meta[property="og:title"]'))) === 'danfeed', await c.evalJS(meta('meta[property="og:title"]')))
  check('the twitter card is the wide one', (await c.evalJS(meta('meta[name="twitter:card"]'))) === 'summary_large_image', await c.evalJS(meta('meta[name="twitter:card"]')))

  console.log('\n=== 2. the share sheet offers the links for this post ===')
  const spy = await c.evalJS(`(() => {
    window.__copied = []
    try {
      navigator.clipboard.writeText = (text) => { window.__copied.push(text); return Promise.resolve() }
      return 'ok'
    } catch { return 'failed' }
  })()`)
  check('clipboard spy installed', spy === 'ok', spy)

  check('the rail has a share button', !!(await c.evalJS(`!!document.querySelector('[aria-label="Share"]')`)))
  await c.evalJS(`document.querySelector('[aria-label="Share"]').click()`)
  await sleep(350)
  const rows = await c.evalJS(shareRows)
  check(
    'the sheet offers the post and the media',
    JSON.stringify(rows.filter((label) => label !== 'Share…')) ===
      '["Copy link to this post","Copy media link"]',
    JSON.stringify(rows),
  )

  await c.evalJS(`document.querySelector('[aria-label="Copy link to this post"]').click()`)
  await sleep(250)
  check(
    'the post link is the canonical Danbooru page',
    (await c.evalJS(copied))[0] === `https://danbooru.donmai.us/posts/${POST_ID}`,
    JSON.stringify(await c.evalJS(copied)),
  )
  check('the row reports the copy', (await c.evalJS(`document.body.innerText`)).includes('Copied'))

  await c.evalJS(`document.querySelector('[aria-label="Copy media link"]').click()`)
  await sleep(250)
  check(
    'the media link is the file the feed is showing',
    (await c.evalJS(copied))[1] === MEDIA,
    JSON.stringify(await c.evalJS(copied)),
  )

  console.log('\n=== 3. a search can be shared too ===')
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(300)
  await c.evalJS(setSearchText('chun-li'))
  await sleep(1400)
  await c.evalJS(`document.querySelector('[aria-label="Share"]').click()`)
  await sleep(350)
  check(
    'the sheet now offers the search',
    (await c.evalJS(shareRows)).includes('Copy link to this search'),
    JSON.stringify(await c.evalJS(shareRows)),
  )
  await c.evalJS(`document.querySelector('[aria-label="Copy link to this search"]').click()`)
  await sleep(250)
  check(
    'the search link points back here, without the rating',
    (await c.evalJS(copied))[2] === `${ORIGIN}/?q=chun-li`,
    JSON.stringify(await c.evalJS(copied)),
  )
  check('three links had been copied in all', (await c.evalJS(copied)).length === 3, JSON.stringify(await c.evalJS(copied)))

  console.log('\n=== 4. opening that link searches it, quietly ===')
  postCalls.length = 0
  autoCalls.length = 0
  await c.send('Page.navigate', { url: `${ORIGIN}/?q=phoenix_reffaella` })
  await waitForSlides(c, 1)
  await sleep(400)
  check('box seeded from the link', (await c.evalJS(boxValue)) === 'phoenix_reffaella', `got ${await c.evalJS(boxValue)}`)
  check(
    'the feed searched it right away',
    postCalls.length > 0 && tagsOf(postCalls[0]).includes('phoenix_reffaella'),
    JSON.stringify(postCalls.map(tagsOf)),
  )
  check('the address bar was cleaned', (await c.evalJS(`location.search`)) === '', `got ${await c.evalJS(`location.search`)}`)
  check('no autocomplete request for a seeded query', autoCalls.length === 0, `got ${autoCalls.length}`)
  check('no suggestion panel over the feed', !(await c.evalJS(panelOpen)))

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
