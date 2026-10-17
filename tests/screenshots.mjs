#!/usr/bin/env node
/**
 * Renders the UI to PNG so a change can be looked at, not only asserted.
 *
 * The artwork is replaced by an SVG gradient, so the overlay is judged against a mid-tone
 * image rather than flat black. Output goes to tests/__shots__ (gitignored).
 *
 *   npm run shots                 every shot at a phone size
 *   npm run shots -- 900x900      a desktop-ish viewport, for the header
 *   npm run shots -- --no-build   reuse the existing dist
 *   npm run shots -- --readme     also copy three of them into docs/ for the README
 *
 * Chrome must be installed, as for `npm run test:e2e`; CHROME_PATH overrides the search.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectToPage, setSearchText, sleep, stubApi, waitForSlides } from './lib/cdp.mjs'
import { buildPost } from './lib/fixtures.mjs'
import {
  findChrome,
  freePort,
  launchChrome,
  runBuild,
  startPreview,
  stopChrome,
  tempProfile,
  waitForCdp,
  waitForHttp,
} from './lib/browser.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'tests', '__shots__')
const argv = process.argv.slice(2)
const size = argv.find((a) => /^\d+x\d+$/.test(a)) ?? process.env.SHOT_SIZE ?? '420x900'
const noBuild = argv.includes('--no-build')
const readme = argv.includes('--readme')

// Two posts: a typical one, and a group picture with entity overflow.
const POSTS = [
  buildPost({
    id: 920001,
    width: 900,
    height: 1400,
    artists: 'corn_kuten',
    characters: 'phoenix_reffaella',
    copyrights: 'zenless_zone_zero',
    general:
      '1girl ahoge apron blue_dress blue_hairband blonde_hair blush brown_hair dress hair_ornament holding_tray indoors long_hair',
    meta: 'absurdres highres',
  }),
  buildPost({
    id: 920002,
    width: 900,
    height: 1400,
    artists: 'a_one b_two c_three',
    characters: 'c_one c_two c_three c_four',
    copyrights: 'p_one p_two',
    general: 'alternate_costume animal_ears bestiality_joke blonde_hair blue_archive',
    meta: 'bad_id',
  }),
]

const GRADIENT = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#7c5cff"/><stop offset="0.5" stop-color="#ff8a5c"/>
<stop offset="1" stop-color="#1fb6a6"/></linearGradient></defs>
<rect width="900" height="1400" fill="url(#g)"/></svg>`

// One row per family, so the badges' colours can be compared at a glance.
const AUTOCOMPLETE = [
  { value: 'phoenix_reffaella', label: 'phoenix reffaella', category: 4, post_count: 567 },
  { value: 'corn_kuten', label: 'corn kuten', category: 1, post_count: 10234 },
  { value: 'zenless_zone_zero', label: 'zenless zone zero', category: 3, post_count: 8321 },
  { value: 'absurdres', label: 'absurdres', category: 5, post_count: 3096144 },
  { value: 'blue_dress', label: 'blue dress', category: 0, post_count: 42150 },
]

/** `related_tag.json` in the shape the live endpoint answers with: the tag itself, meta, and rows. */
const RELATED = {
  query: 'corn_kuten',
  post_count: 645,
  tag: null,
  related_tags: [
    ['corn_kuten', 1, 1, 645],
    ['commentary_request', 5, 0.82, 6438530],
    ['long_hair', 0, 0.69, 6319158],
    ['open_mouth', 0, 0.68, 5000000],
    ['blue_dress', 0, 0.42, 42150],
    ['absurdres', 5, 0.5, 3075827],
    ['looking_at_viewer', 0, 0.37, 5010308],
  ].map(([name, category, frequency, post_count]) => ({
    tag: { id: 1, name, category, post_count, is_deprecated: false },
    cosine_similarity: frequency,
    jaccard_similarity: frequency / 10,
    overlap_coefficient: frequency,
    frequency,
  })),
  wiki_page_tags: [],
}

let preview = null
let browser = null
let profile = null
/** The stubbed routes, re-stubbed mid-run to stage the last two shots. */
let interceptor = null
const GRADIENT_PNG = Buffer.from(GRADIENT).toString('base64')

async function cleanup() {
  if (browser) await stopChrome(browser, profile)
  if (preview && preview.exitCode === null) preview.kill()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  if (!noBuild) runBuild(ROOT)

  const appPort = await freePort()
  const appUrl = `http://localhost:${appPort}/`
  preview = startPreview({ root: ROOT, port: appPort })
  if (!(await waitForHttp(appUrl))) throw new Error(`preview never answered on ${appUrl}`)

  const cdpPort = await freePort()
  profile = tempProfile()
  browser = launchChrome({ port: cdpPort, profile, windowSize: size, executable: findChrome() })
  if (!(await waitForCdp(cdpPort))) throw new Error('Chrome never opened its debug port')

  const c = await connectToPage(cdpPort)
  // Headless Chrome never gives the page system focus, so `focus()` would not open anything.
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  interceptor = await stubApi(c, [
    { match: '/autocomplete.json', json: AUTOCOMPLETE },
    { match: '/posts.json', json: POSTS },
    { match: '/related_tag.json', json: RELATED },
    {
      match: 'cdn.donmai.us',
      image: GRADIENT_PNG,
      type: 'image/svg+xml',
    },
  ])

  await c.send('Page.navigate', { url: appUrl })
  await waitForSlides(c, POSTS.length)
  await sleep(1200)
  await c.shot(join(OUT, 'header.png'))
  await c.shot(join(OUT, 'row.png'))

  await c.evalJS(
    `document.querySelectorAll('[data-slide]')[0].querySelector('[aria-label="Show all tags"]').click()`,
  )
  await sleep(500)
  await c.shot(join(OUT, 'sheet.png'))

  // Second slide: entity overflow and the group picture.
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(300)
  await c.evalJS(`(() => {
    let el = document.querySelector('[data-slide]')
    while (el && el.scrollHeight <= el.clientHeight + 4) el = el.parentElement
    if (el) el.scrollTop = el.clientHeight
    return el ? el.className : 'no scroller'
  })()`)
  await sleep(1500)
  await c.shot(join(OUT, 'group.png'))

  // The suggestion panel: one row per tag family, to check the badges against the slide dots.
  await c.evalJS(setSearchText('ph'))
  await sleep(800)
  await c.shot(join(OUT, 'panel.png'))

  // Recent searches: an empty box, focused, with a little history behind it.
  await c.evalJS(`document.querySelector('[role="combobox"]').blur()`)
  await sleep(200)
  await c.evalJS(setSearchText('blue_dress'))
  await sleep(1000)
  await c.evalJS(setSearchText('corn_kuten'))
  await sleep(1000)
  await c.evalJS(setSearchText(''))
  await sleep(250)
  await c.evalJS(`document.querySelector('[role="combobox"]').focus()`)
  await sleep(300)
  await c.shot(join(OUT, 'recents.png'))

  // The share sheet, with a search in the box so every row is on screen.
  await c.evalJS(setSearchText('corn_kuten'))
  await sleep(300)
  await c.evalJS(`document.querySelector('[role="combobox"]').blur()`)
  await sleep(250)
  await c.evalJS(`document.querySelector('[aria-label="Share"]').click()`)
  await sleep(400)
  await c.shot(join(OUT, 'share.png'))
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(300)

  // Settings, scrolled to the backup block at the bottom of the sheet.
  await c.evalJS(`document.querySelector('[aria-label^="Settings"]').click()`)
  await sleep(400)
  await c.evalJS(`(() => {
    const h = Array.from(document.querySelectorAll('h2')).find((el) => el.textContent === 'Settings')
    const panel = h?.parentElement?.parentElement
    if (panel) panel.scrollTop = panel.scrollHeight
    return panel ? 'scrolled' : 'no panel'
  })()`)
  await sleep(300)
  await c.shot(join(OUT, 'backup.png'))

  // A tag's own actions: what a long press on a chip opens. Reached by right-click here, which
  // is the same gesture done with a mouse.
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(350)
  await c.evalJS(
    `document.querySelector('[data-slide] [aria-label^="Show more by artist"]').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    )`,
  )
  await sleep(400)
  await c.shot(join(OUT, 'tag-actions.png'))
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(300)

  // More like this: what Danbooru says usually appears alongside the artist on the slide.
  await c.evalJS(`document.querySelector('[data-slide] [aria-label="More like this"]').click()`)
  await sleep(500)
  await c.shot(join(OUT, 'related.png'))
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(300)

  // The keyboard map.
  await c.evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`)
  await sleep(400)
  await c.shot(join(OUT, 'shortcuts.png'))
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(300)

  // Two states that need staging rather than clicking: a slow image, and no input at all.
  //
  // Route order stages the first — the preview answers instantly, the sample is held back — so
  // the poll happens while the placeholder still carries the frame. Then the same page sits
  // untouched past the idle window, and the label and rail step back to a quarter.
  if (interceptor) c.off(interceptor)
  interceptor = await stubApi(c, [
    { match: '/autocomplete.json', json: AUTOCOMPLETE },
    { match: '/posts.json', json: POSTS },
    { match: '/related_tag.json', json: RELATED },
    { match: '180x180', image: GRADIENT_PNG, type: 'image/svg+xml' },
    { match: 'cdn.donmai.us', image: GRADIENT_PNG, type: 'image/svg+xml', delay: 2500 },
  ])
  await c.send('Page.navigate', { url: appUrl })
  await waitForSlides(c, POSTS.length)
  await sleep(900)
  await c.shot(join(OUT, 'blur-up.png'))
  await sleep(4000)
  await c.shot(join(OUT, 'quiet.png'))

  // Woken up, then the filled bookmark: the rail's one white button, and the only place a save
  // shows at rest.
  await c.evalJS(`document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  await sleep(300)
  await c.evalJS(`document.querySelector('[aria-label="Save"]').click()`)
  await sleep(400)
  await c.shot(join(OUT, 'saved.png'))

  // The over-limit notice: three tags in the box, the request refused before it is sent, and the
  // button that takes them back out. The box is blurred first so the suggestion panel is not
  // sitting on top of the thing being photographed.
  await c.evalJS(setSearchText('1girl blue_dress absurdres silence'))
  await sleep(400)
  await c.evalJS(
    `document.querySelector('[role="combobox"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await sleep(400)
  await c.shot(join(OUT, 'tag-limit.png'))

  if (readme) {
    // The three the repository page links to. These are commits, not build output, so they are
    // copies of the shots above (`docs/` is not gitignored) rather than the throwaway set.
    const docs = join(ROOT, 'docs')
    mkdirSync(docs, { recursive: true })
    const picked = [
      ['row.png', 'feed.png'],
      ['related.png', 'related.png'],
      ['shortcuts.png', 'shortcuts.png'],
    ]
    for (const [from, to] of picked) {
      copyFileSync(join(OUT, from), join(docs, to))
      console.log(`wrote docs/${to}`)
    }
  }
}

main()
  .then(cleanup)
  .catch(async (e) => {
    console.error(`shots error: ${e.message}`)
    await cleanup()
    process.exit(2)
  })
