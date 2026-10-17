/**
 * Recent searches: what gets remembered, what does not, and the panel that offers them back.
 *
 * History is "queries that actually went to the API" — the default feed, an over-limit query and
 * the logo reset have no business in it — and the panel it opens must never fire an autocomplete
 * request. It is a list of finished searches, not a completion aid, and the difference is what
 * keeps it from covering the feed the way a suggestion drop-down would.
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
const POSTS = [
  {
    id: 900401,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 300000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/900401.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/aa/bb/sample-900401.jpg',
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/900401.jpg',
    tag_string: 'corn_kuten 1girl solo',
    tag_string_artist: 'corn_kuten',
    tag_count: 3,
    is_animated: false,
    media_asset: { id: 1, variants: [] },
  },
]

/** How long a typed query needs: the box debounces 450ms, then the request runs. */
const SEARCH_SETTLE = 1400

const boxValue = `document.querySelector('[role="combobox"]').value`
const isFocused = `document.activeElement === document.querySelector('[role="combobox"]')`
const panelOpen = `!!document.getElementById('tag-suggestions')`
const rowLabels = `Array.from(document.querySelectorAll('#tag-suggestions [role="option"]')).map(el => el.getAttribute('aria-label'))`
/** The storage key the app writes; versioned, so reading it here is deliberate. */
const storedRecent = `JSON.parse(localStorage.getItem('danfeed.recent.v1') || '[]')`

function tagsOf(url) {
  return decodeURIComponent(new URL(url).searchParams.get('tags') ?? '')
}

async function main() {
  const c = await connectToPage(CDP_PORT)
  /**
   * Headless Chrome does not give the page system focus, so `element.focus()` moves
   * activeElement without ever firing a focus event — and the box's "someone is in it" state
   * stays off. Emulating a focused page is what a phone has, and without it this suite would be
   * asserting against a state no real visitor can reach.
   */
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true })

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

  console.log('\n=== 1. typing is one search, not a trail of fragments ===')
  check('the default feed wrote no history', JSON.stringify(await c.evalJS(storedRecent)) === '[]', `got ${JSON.stringify(await c.evalJS(storedRecent))}`)
  await c.evalJS(setSearchText('chun'))
  await sleep(SEARCH_SETTLE)
  await c.evalJS(setSearchText('chun-li'))
  await sleep(SEARCH_SETTLE)
  check(
    'the finished query replaced the fragment it grew from',
    JSON.stringify(await c.evalJS(storedRecent)) === '["chun-li"]',
    `got ${JSON.stringify(await c.evalJS(storedRecent))}`,
  )

  console.log('\n=== 2. an empty box offers the history, and nothing else ===')
  autoCalls.length = 0
  await c.evalJS(setSearchText(''))
  await sleep(250)
  await c.evalJS(`document.querySelector('[role="combobox"]').focus()`)
  await sleep(250)
  check('box is empty and focused', (await c.evalJS(boxValue)) === '' && (await c.evalJS(isFocused)))
  check(
    'the past search is offered back',
    JSON.stringify(await c.evalJS(rowLabels)) === '["Recent search chun-li"]',
    `got ${JSON.stringify(await c.evalJS(rowLabels))}`,
  )
  check('offering history fired no autocomplete request', autoCalls.length === 0, `got ${autoCalls.length}`)

  console.log('\n=== 3. picking one runs that search ===')
  postCalls.length = 0
  autoCalls.length = 0
  await c.evalJS(`document.querySelector('#tag-suggestions [role="option"]').click()`)
  await sleep(SEARCH_SETTLE)
  check('box took the query', (await c.evalJS(boxValue)) === 'chun-li', `got ${await c.evalJS(boxValue)}`)
  check(
    'the search went out',
    postCalls.some((url) => tagsOf(url).includes('chun-li')),
    `posts requests: ${JSON.stringify(postCalls.map(tagsOf))}`,
  )
  check('picking fired no autocomplete request', autoCalls.length === 0, `got ${autoCalls.length}`)
  check('panel closed behind it', !(await c.evalJS(panelOpen)))
  check(
    're-running a search did not duplicate it',
    JSON.stringify(await c.evalJS(storedRecent)) === '["chun-li"]',
    `got ${JSON.stringify(await c.evalJS(storedRecent))}`,
  )

  console.log('\n=== 4. newest first ===')
  await c.evalJS(setSearchText('miku'))
  await sleep(SEARCH_SETTLE)
  check(
    'the second search leads the list',
    JSON.stringify(await c.evalJS(storedRecent)) === '["miku","chun-li"]',
    `got ${JSON.stringify(await c.evalJS(storedRecent))}`,
  )
  await c.evalJS(setSearchText(''))
  await sleep(250)
  await c.evalJS(`document.querySelector('[role="combobox"]').focus()`)
  await sleep(250)
  check(
    'both are offered, newest first',
    JSON.stringify(await c.evalJS(rowLabels)) === '["Recent search miku","Recent search chun-li"]',
    `got ${JSON.stringify(await c.evalJS(rowLabels))}`,
  )

  console.log('\n=== 5. clearing the history ===')
  await c.evalJS(`document.querySelector('[aria-label="Clear recent searches"]').click()`)
  await sleep(300)
  check('panel withdrawn', !(await c.evalJS(panelOpen)))
  check('storage emptied', JSON.stringify(await c.evalJS(storedRecent)) === '[]', `got ${JSON.stringify(await c.evalJS(storedRecent))}`)
  await c.evalJS(`document.querySelector('[role="combobox"]').blur()`)
  await sleep(150)
  await c.evalJS(`document.querySelector('[role="combobox"]').focus()`)
  await sleep(250)
  check('nothing left to offer', !(await c.evalJS(panelOpen)))

  console.log('\n=== 6. a chip is a search; the logo reset is not ===')
  postCalls.length = 0
  await c.evalJS(`document.querySelector('[aria-label^="Show more by artist"]').click()`)
  await sleep(SEARCH_SETTLE)
  check(
    'the tapped tag joined the history',
    JSON.stringify(await c.evalJS(storedRecent)) === '["corn_kuten"]',
    `got ${JSON.stringify(await c.evalJS(storedRecent))}`,
  )
  await c.evalJS(`document.querySelector('[aria-label^="danfeed"]').click()`)
  await sleep(900)
  check(
    'the reset added nothing',
    JSON.stringify(await c.evalJS(storedRecent)) === '["corn_kuten"]',
    `got ${JSON.stringify(await c.evalJS(storedRecent))}`,
  )
  check('the reset cleared the box', (await c.evalJS(boxValue)) === '', `got ${await c.evalJS(boxValue)}`)
  check('the reset left the panel shut', !(await c.evalJS(panelOpen)))

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
