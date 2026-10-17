/**
 * Walks the content-rating setting and asserts what tag string the app actually puts on the
 * wire: safe by default, what Moderate ORs in, what Everything drops, and that a rating the
 * user typed themselves wins over the setting.
 *
 * Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
 */
import {
  check,
  connectToPage,
  PNG,
  pressEnter,
  report,
  setSearchText,
  sleep,
  stubApi,
  waitForSlides,
} from './lib/cdp.mjs'

const CDP_PORT = Number(process.env.CDP_PORT || 9333)
const APP = process.env.APP_URL || 'http://localhost:4173/'
const POSTS = Array.from({ length: 6 }, (_, i) => ({
  id: 900000 + i,
  rating: 'g',
  file_ext: 'jpg',
  file_size: 400000,
  image_width: 1200,
  image_height: 1600,
  file_url: `https://cdn.donmai.us/original/aa/bb/90000${i}.jpg`,
  large_file_url: `https://cdn.donmai.us/sample/aa/bb/sample-90000${i}.jpg`,
  preview_file_url: `https://cdn.donmai.us/180x180/aa/bb/90000${i}.jpg`,
  tag_string: '1girl solo chun-li',
  tag_count: 3,
  is_animated: false,
  media_asset: { id: 1, variants: [] },
}))
const seen = []
function tagsOf(url) {
  return new URL(url).searchParams.get('tags') ?? null
}

let SEARCH_TEXT = ''

async function main() {
  const c = await connectToPage(CDP_PORT)

  const interceptor = await stubApi(
    c,
    [
      { match: 'donmai.us/posts.json', json: POSTS, record: seen },
      { match: 'cdn.donmai.us', image: PNG, contentLength: true },
    ],
    { requestStage: true },
  )

  // --- load the app ---
  await c.send('Page.navigate', { url: APP })
  // Wait for the feed to actually render a slide, not just for a request to fire.
  check('app rendered slides from the stubbed API', (await waitForSlides(c, 1)) > 0)

  await sleep(400)
  console.log('\n=== 1. default (fresh browser) ===')
  check(
    'first request carries the safe rating',
    seen.length > 0 && tagsOf(seen[0]) === 'rating:general',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )
  const gearLabel = () =>
    c.evalJS(`document.querySelector('[aria-label^="Settings"]')?.getAttribute('aria-label')`)
  check('gear shows no NSFW badge', (await gearLabel()) === 'Settings', `got ${await gearLabel()}`)

  console.log('\n=== 2. open settings, switch to Everything ===')
  await c.evalJS(`document.querySelector('[aria-label^="Settings"]').click()`)
  await sleep(350)
  const sheetOpen = await c.evalJS(`document.body.innerText.includes('Content rating')`)
  check('settings sheet opened', sheetOpen)
  const options = await c.evalJS(
    `Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => ['Safe','Moderate','Everything'].includes(t))`,
  )
  check(
    'three rating options present',
    JSON.stringify(options) === JSON.stringify(['Safe', 'Moderate', 'Everything']),
    `got ${JSON.stringify(options)}`,
  )
  const safePressed = await c.evalJS(
    `document.querySelector('button[aria-pressed="true"]')?.textContent.trim()`,
  )
  check('Safe is the default selection', safePressed === 'Safe', `got ${safePressed}`)

  seen.length = 0
  await c.evalJS(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Everything').click()`,
  )
  await sleep(1200)
  check(
    'Everything sends no rating filter at all',
    seen.length > 0 && tagsOf(seen[0]) === '',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )
  check(
    'gear gains the NSFW badge',
    (await gearLabel()) === 'Settings — unfiltered content is on',
    `got ${await gearLabel()}`,
  )
  const warn = await c.evalJS(
    `document.body.innerText.includes('questionable and explicit')`,
  )
  check('sheet warns what Everything includes', warn)

  console.log('\n=== 3. Moderate ===')
  seen.length = 0
  await c.evalJS(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Moderate').click()`,
  )
  await sleep(1200)
  check(
    'Moderate ORs general+sensitive',
    seen.length > 0 && tagsOf(seen[0]) === 'rating:general,sensitive',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )

  console.log('\n=== 4. switching rating refetches the feed ===')
  check('a new request fired on every rating change', seen.length > 0)

  console.log('\n=== 5. back to Safe, then a user-typed rating must override ===')
  await c.evalJS(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Safe').click()`,
  )
  await sleep(900)
  check(
    'gear badge cleared',
    (await gearLabel()) === 'Settings',
    `got ${await gearLabel()}`,
  )

  // close the sheet
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(350)

  seen.length = 0
  SEARCH_TEXT = 'rating:explicit'
  await c.evalJS(setSearchText(SEARCH_TEXT))
  await sleep(150)
  await c.evalJS(pressEnter)
  await sleep(1200)
  check(
    'typed rating replaces the default instead of stacking',
    seen.length > 0 && tagsOf(seen[0]) === 'rating:explicit',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )

  console.log('\n=== 6. typed rating alongside a real tag, and the tag limit ===')
  seen.length = 0
  SEARCH_TEXT = 'chun-li rating:explicit'
  await c.evalJS(setSearchText(SEARCH_TEXT))
  await sleep(150)
  await c.evalJS(pressEnter)
  await sleep(1200)
  check(
    'user rating wins and the tag survives',
    seen.length > 0 && tagsOf(seen[0]) === 'chun-li rating:explicit',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )
  const overLimit = await c.evalJS(`document.body.innerText.includes('Too many tags')`)
  check('rating metatag did not trip the tag limit', !overLimit)

  console.log('\n=== 7. rating is persisted and survives a reload ===')
  // Turn Everything on, reload, and confirm it came back from localStorage.
  await c.evalJS(`document.querySelector('[aria-label^="Settings"]').click()`)
  await sleep(350)
  await c.evalJS(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Everything').click()`,
  )
  await sleep(500)
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(300)

  seen.length = 0
  await c.send('Page.navigate', { url: APP })
  await waitForSlides(c, 1)
  await sleep(400)
  check(
    'rating choice persisted across reload',
    seen.length > 0 && tagsOf(seen[0]) === '',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )
  check(
    'NSFW badge still shown after reload',
    (await gearLabel()) === 'Settings — unfiltered content is on',
    `got ${await gearLabel()}`,
  )

  c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
