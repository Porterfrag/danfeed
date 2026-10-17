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
 *
 * Chrome must be installed, as for `npm run test:e2e`; CHROME_PATH overrides the search.
 */
import { mkdirSync } from 'node:fs'
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

let preview = null
let browser = null
let profile = null

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
  await stubApi(c, [
    { match: '/autocomplete.json', json: AUTOCOMPLETE },
    { match: '/posts.json', json: POSTS },
    {
      match: 'cdn.donmai.us',
      image: Buffer.from(GRADIENT).toString('base64'),
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

  // The keyboard map.
  await c.evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }))`)
  await sleep(400)
  await c.shot(join(OUT, 'shortcuts.png'))
}

main()
  .then(cleanup)
  .catch(async (e) => {
    console.error(`shots error: ${e.message}`)
    await cleanup()
    process.exit(2)
  })
