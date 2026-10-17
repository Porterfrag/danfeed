/**
 * Regression test for the suggestion panel opening over the feed.
 *
 * Tapping a tag chip on a slide sets the search text from outside the box. That must not fire
 * an autocomplete request or drop the suggestion panel over the feed; only text typed into the
 * box should.
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
    id: 900301,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 300000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/900301.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/aa/bb/sample-900301.jpg',
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/900301.jpg',
    tag_string: 'corn_kuten phoenix_reffaella zenless_zone_zero 1girl solo',
    tag_string_artist: 'corn_kuten',
    tag_string_character: 'phoenix_reffaella',
    tag_string_copyright: 'zenless_zone_zero',
    is_animated: false,
    media_asset: { id: 1, variants: [] },
  },
]

const AUTOCOMPLETE = [
  { value: 'phoenix_reffaella', label: 'phoenix reffaella', category: 4, post_count: 567 },
  { value: 'phoenix_wright', label: 'phoenix wright', category: 4, post_count: 4321 },
]

const autoCalls = []
const postCalls = []

const panelOpen = `!!document.getElementById('tag-suggestions')`
/** What is physically on screen in the middle of the feed, and is it the panel? */
const overFeed = `(() => {
  const el = document.elementFromPoint(210, 150)
  if (!el) return 'none'
  return el.closest('#tag-suggestions') ? 'PANEL COVERS THE FEED' : 'feed'
})()`
const boxValue = `document.querySelector('[role="combobox"]').value`

async function main() {
  const c = await connectToPage(CDP_PORT)
  const pageErrors = watchPageErrors(c)

  await stubApi(c, [
    { match: '/autocomplete.json', json: AUTOCOMPLETE, record: autoCalls },
    { match: '/posts.json', json: POSTS, record: postCalls },
    { match: 'cdn.donmai.us', image: PNG },
  ])

  await c.send('Page.navigate', { url: APP })
  await waitForSlides(c, 1)
  await sleep(400)

  console.log('\n=== 1. tapping a tag chip must not open the suggestion panel ===')
  autoCalls.length = 0
  postCalls.length = 0
  await c.evalJS(`document.querySelector('[aria-label="Show more by artist corn kuten"]').click()`)
  await sleep(1800)
  check('no suggestion panel', !(await c.evalJS(panelOpen)), 'panel is in the DOM')
  check('nothing covers the feed', (await c.evalJS(overFeed)) === 'feed', await c.evalJS(overFeed))
  check(
    'no autocomplete request fired',
    autoCalls.length === 0,
    `got ${autoCalls.length}: ${JSON.stringify(autoCalls)}`,
  )
  check(
    'the tap still searches the tag',
    postCalls.some((u) => decodeURIComponent(u).includes('corn_kuten')),
    `posts requests: ${JSON.stringify(postCalls.map((u) => decodeURIComponent(new URL(u).searchParams.get('tags'))))}`,
  )
  check('tag is in the box', (await c.evalJS(boxValue)) === 'corn_kuten', await c.evalJS(boxValue))

  console.log('\n=== 2. tapping a character chip is the same ===')
  autoCalls.length = 0
  await c.evalJS(
    `document.querySelector('[aria-label="Show more of character phoenix reffaella"]').click()`,
  )
  await sleep(1800)
  check('no suggestion panel', !(await c.evalJS(panelOpen)))
  check('no autocomplete request fired', autoCalls.length === 0, `got ${autoCalls.length}`)

  console.log('\n=== 3. typing still suggests ===')
  await c.evalJS(`document.querySelector('[role="combobox"]').focus()`)
  await sleep(600)
  check(
    'focusing alone does not summon the panel',
    !(await c.evalJS(panelOpen)),
    'panel opened on focus',
  )
  autoCalls.length = 0
  await c.evalJS(setSearchText('phoe'))
  await sleep(1800)
  check('panel opens for typed text', await c.evalJS(panelOpen))
  check('autocomplete requested', autoCalls.length > 0, `got ${autoCalls.length}`)
  const options = await c.evalJS(
    `Array.from(document.querySelectorAll('[role="option"]')).map(o => o.innerText.replace(/\\n/g, ' '))`,
  )
  check('suggestions are rendered', options.length === 2, JSON.stringify(options))

  console.log('\n=== 4. a chip tapped while the box is focused still wins ===')
  autoCalls.length = 0
  await c.evalJS(
    `document.querySelector('[aria-label="Show more from zenless zone zero"]').click()`,
  )
  await sleep(1800)
  check('panel closed', !(await c.evalJS(panelOpen)), 'panel stayed open over the feed')
  check('nothing covers the feed', (await c.evalJS(overFeed)) === 'feed', await c.evalJS(overFeed))
  check('no autocomplete request fired', autoCalls.length === 0, `got ${autoCalls.length}`)

  console.log('\n=== 5. accepting a suggestion still works and closes up ===')
  await c.evalJS(setSearchText('phoe'))
  await sleep(1600)
  check('panel open before accepting', await c.evalJS(panelOpen))
  autoCalls.length = 0
  await c.evalJS(`document.querySelectorAll('[role="option"]')[1].click()`)
  await sleep(1600)
  check('panel closed after accepting', !(await c.evalJS(panelOpen)))
  check(
    'underscored value inserted with a trailing space',
    (await c.evalJS(boxValue)) === 'phoenix_wright ',
    JSON.stringify(await c.evalJS(boxValue)),
  )
  check('accepting fired no autocomplete request', autoCalls.length === 0, `got ${autoCalls.length}`)

  console.log('\n=== 6. clearing and the logo reset stay quiet ===')
  autoCalls.length = 0
  await c.evalJS(`document.querySelector('[aria-label^="danfeed"]').click()`)
  await sleep(1800)
  check('logo reset closes the panel', !(await c.evalJS(panelOpen)))
  check('logo reset fired no autocomplete request', autoCalls.length === 0, `got ${autoCalls.length}`)
  check('box cleared', (await c.evalJS(boxValue)) === '', JSON.stringify(await c.evalJS(boxValue)))

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
