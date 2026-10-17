/**
 * Tag actions: what a hold (or a right-click) on a chip offers, and that a tap still just searches.
 *
 * The two gestures share one button, so most of this suite is about them not eating each other:
 * a tap must search, a hold must not also search, and a drag past a chip must do neither. The
 * long press is 450ms in the app; the waits here are longer than that on purpose.
 *
 * Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
 */
import {
  check,
  connectToPage,
  mouseClick,
  PNG,
  report,
  sleep,
  stubApi,
  waitForSlides,
  watchPageErrors,
} from './lib/cdp.mjs'

const CDP_PORT = Number(process.env.CDP_PORT || 9335)
const APP = process.env.APP_URL || 'http://localhost:4173/'
const ORIGIN = new URL(APP).origin
const POST_ID = 920801
const MEDIA = 'https://cdn.donmai.us/sample/aa/bb/920801.jpg'

const POSTS = [
  {
    id: POST_ID,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 250000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/920801.jpg',
    large_file_url: MEDIA,
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/920801.jpg',
    tag_string: '1girl solo smile standing long_hair black_hair',
    tag_string_artist: 'phoenix_reffaella',
    tag_string_character: 'chun-li',
    tag_string_copyright: 'street_fighter',
    tag_count: 9,
    is_animated: false,
    media_asset: { id: 1, variants: [] },
  },
]

const ARTIST_CHIP = '[aria-label^="Show more by artist"]'
const GENERAL_CHIP = '[aria-label^="Show more with tag"]'
const ALL_TAGS = '[aria-label="Show all tags"]'
const dialogTitle = `document.querySelector('[role="dialog"]')?.querySelector('h2')?.textContent ?? ''`
const dialogs = `Array.from(document.querySelectorAll('[role="dialog"]')).map(d => d.querySelector('h2')?.textContent ?? '')`
const sheetText = `document.querySelector('[role="dialog"]')?.innerText ?? ''`
const boxValue = `document.querySelector('[role="combobox"]').value`
const liveText = `document.querySelector('[aria-live="polite"]').textContent ?? ''`
const activeLabel = `document.activeElement?.getAttribute('aria-label') ?? ''`
const rows = `Array.from(document.querySelectorAll('[role="dialog"] [aria-label]')).map(e => ({
  label: e.getAttribute('aria-label'), tag: e.tagName, href: e.getAttribute('href') ?? '', target: e.getAttribute('target') ?? ''
}))`

function tagsOf(url) {
  return decodeURIComponent(new URL(url).searchParams.get('tags') ?? '')
}

/** Start a pointer-down on a chip, to be followed by a wait. */
const holdDown = (selector) => `(() => {
  const chip = document.querySelector(${JSON.stringify(selector)})
  if (!chip) return 'missing'
  const rect = chip.getBoundingClientRect()
  chip.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, isPrimary: true, button: 0,
    clientX: rect.left + 4, clientY: rect.top + 4,
  }))
  return 'down'
})()`

const holdMove = (selector, dx) => `(() => {
  const chip = document.querySelector(${JSON.stringify(selector)})
  const rect = chip.getBoundingClientRect()
  chip.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, isPrimary: true, button: 0,
    clientX: rect.left + 4 + ${dx}, clientY: rect.top + 4,
  }))
  return 'move'
})()`

const release = (selector) => `(() => {
  const chip = document.querySelector(${JSON.stringify(selector)})
  chip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0 }))
  chip.click()
  return 'released'
})()`

async function main() {
  const c = await connectToPage(CDP_PORT)
  const postCalls = []
  const pageErrors = watchPageErrors(c)

  // Headless Chrome never gives the page system focus on its own, so focus events do not fire
  // and a clicked button never ends up as `document.activeElement`. This turns that on, which is
  // what the focus-restore assertion at the end depends on.
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  const interceptor = await stubApi(c, [
    { match: 'donmai.us/posts.json', json: POSTS, record: postCalls },
    { match: 'donmai.us/autocomplete.json', json: [] },
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])

  await c.send('Page.navigate', { url: APP })
  check('a slide rendered', (await waitForSlides(c, 1)) > 0)
  await sleep(500)

  await c.evalJS(`(() => {
    window.__copied = []
    navigator.clipboard.writeText = (text) => { window.__copied.push(text); return Promise.resolve() }
    return 'ok'
  })()`)

  console.log('\n=== 1. a tap still searches ===')
  const beforeTap = postCalls.length
  await c.evalJS(`document.querySelector('${ARTIST_CHIP}').click()`)
  await sleep(600)
  check('tapping the chip opens no sheet', (await c.evalJS(dialogTitle)) === '', await c.evalJS(dialogTitle))
  check(
    'it searches the tag',
    postCalls.length > beforeTap && tagsOf(postCalls.at(-1)).includes('phoenix_reffaella'),
    tagsOf(postCalls.at(-1) ?? ''),
  )
  check('the tag lands in the search box', (await c.evalJS(boxValue)) === 'phoenix_reffaella', await c.evalJS(boxValue))
  await c.evalJS(`document.querySelector('[aria-label^="danfeed"]').click()`)
  await sleep(600)

  console.log('\n=== 2. a hold offers the rest ===')
  const beforeHold = postCalls.length
  check('the chip says it has a popup', (await c.evalJS(`document.querySelector('${ARTIST_CHIP}').getAttribute('aria-haspopup')`)) === 'dialog')
  check('the hold starts', (await c.evalJS(holdDown(ARTIST_CHIP))) === 'down')
  await sleep(650)
  check('holding opens the sheet for that tag', (await c.evalJS(dialogTitle)) === '#phoenix reffaella', await c.evalJS(dialogTitle))
  await c.evalJS(release(ARTIST_CHIP))
  await sleep(300)
  check('and the release does not also search', postCalls.length === beforeHold, JSON.stringify(postCalls.map(tagsOf)))
  check('the sheet is still open', (await c.evalJS(dialogTitle)) === '#phoenix reffaella')

  const labels = (await c.evalJS(rows)).map((r) => r.label)
  check(
    'the sheet offers searching here first',
    labels.includes('Search danfeed for phoenix reffaella'),
    JSON.stringify(labels),
  )
  const danbooru = (await c.evalJS(rows)).find((r) => r.label === 'Open phoenix reffaella on Danbooru')
  check(
    'the Danbooru row is a real link to the tag’s gallery',
    danbooru?.tag === 'A' &&
      danbooru.href === 'https://danbooru.donmai.us/posts?tags=phoenix_reffaella' &&
      danbooru.target === '_blank',
    JSON.stringify(danbooru),
  )
  const wiki = (await c.evalJS(rows)).find((r) => r.label === 'About the artist phoenix reffaella')
  check(
    'the wiki row points at the artist’s page',
    wiki?.tag === 'A' && wiki.href === 'https://danbooru.donmai.us/wiki_pages/phoenix_reffaella',
    JSON.stringify(wiki),
  )
  check(
    'the sheet spells out the search link',
    (await c.evalJS(sheetText)).includes(`${ORIGIN}/?q=phoenix_reffaella`),
  )

  console.log('\n=== 3. the link can be copied ===')
  await c.evalJS(`document.querySelector('[role="dialog"] [aria-label="Copy link to this search"]').click()`)
  await sleep(300)
  check(
    'the copy is a link back here with the tag',
    JSON.stringify(await c.evalJS(`window.__copied`)) === `["${ORIGIN}/?q=phoenix_reffaella"]`,
    JSON.stringify(await c.evalJS(`window.__copied`)),
  )
  check('the row reports it', (await c.evalJS(sheetText)).includes('Copied'))
  check('and the announcement says so', (await c.evalJS(liveText)).includes('Search link copied'), await c.evalJS(liveText))

  console.log('\n=== 4. the first row searches ===')
  const beforeSearch = postCalls.length
  await c.evalJS(`document.querySelector('[role="dialog"] [aria-label="Search danfeed for phoenix reffaella"]').click()`)
  await sleep(600)
  check('the sheet closes behind the search', (await c.evalJS(dialogTitle)) === '', await c.evalJS(dialogTitle))
  check(
    'and the feed searches the tag',
    postCalls.length > beforeSearch && tagsOf(postCalls.at(-1)).includes('phoenix_reffaella'),
    tagsOf(postCalls.at(-1) ?? ''),
  )
  check('with the tag in the box', (await c.evalJS(boxValue)) === 'phoenix_reffaella')
  await c.evalJS(`document.querySelector('[aria-label^="danfeed"]').click()`)
  await sleep(600)

  console.log('\n=== 5. right-click, and plain tags ===')
  await c.evalJS(`(() => {
    const chip = document.querySelector('${GENERAL_CHIP}')
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    return 'ok'
  })()`)
  await sleep(350)
  check('a right-click opens the sheet too', (await c.evalJS(dialogTitle)) === '#1girl', await c.evalJS(dialogTitle))
  const generalLabels = (await c.evalJS(rows)).map((r) => r.label)
  check(
    'a general tag gets the plain wording',
    generalLabels.includes('About the tag 1girl') && generalLabels.includes('Search danfeed for 1girl'),
    JSON.stringify(generalLabels),
  )
  await c.evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(300)
  check('escape closes it', (await c.evalJS(dialogTitle)) === '', await c.evalJS(dialogTitle))
  const beforeAfterHold = postCalls.length
  await c.evalJS(`document.querySelector('${GENERAL_CHIP}').click()`)
  await sleep(600)
  check(
    'the chip still searches normally afterwards',
    postCalls.length > beforeAfterHold && tagsOf(postCalls.at(-1)).includes('1girl'),
    tagsOf(postCalls.at(-1) ?? ''),
  )
  await c.evalJS(`document.querySelector('[aria-label^="danfeed"]').click()`)
  await sleep(600)

  console.log('\n=== 6. a drag past a chip is not a hold ===')
  check('the drag starts', (await c.evalJS(holdDown(ARTIST_CHIP))) === 'down')
  await c.evalJS(holdMove(ARTIST_CHIP, 24))
  await sleep(700)
  check('scrolling past a chip opens nothing', (await c.evalJS(dialogTitle)) === '', await c.evalJS(dialogTitle))
  await c.evalJS(`document.querySelector('${ARTIST_CHIP}').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0 }))`)

  console.log('\n=== 7. the all-tags sheet answers the same hold ===')
  await mouseClick(c, ALL_TAGS)
  await sleep(350)
  check('the tags sheet is open', (await c.evalJS(dialogTitle)) === `Tags · #${POST_ID}`, await c.evalJS(dialogTitle))
  const rowSelector = '[role="dialog"] [aria-label^="Search "]'
  check('a row holds', (await c.evalJS(holdDown(rowSelector))) === 'down')
  await sleep(650)
  check(
    'two sheets are stacked, newest in front',
    JSON.stringify(await c.evalJS(dialogs)) === JSON.stringify([`Tags · #${POST_ID}`, '#phoenix reffaella']),
    JSON.stringify(await c.evalJS(dialogs)),
  )
  await c.evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(350)
  check(
    'escape closes only the one in front',
    JSON.stringify(await c.evalJS(dialogs)) === JSON.stringify([`Tags · #${POST_ID}`]),
    JSON.stringify(await c.evalJS(dialogs)),
  )
  await c.evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(350)
  check('a second escape closes the list', (await c.evalJS(dialogs)).length === 0, JSON.stringify(await c.evalJS(dialogs)))
  check(
    'and focus came back to the button that opened it',
    (await c.evalJS(activeLabel)) === 'Show all tags',
    await c.evalJS(activeLabel),
  )

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
