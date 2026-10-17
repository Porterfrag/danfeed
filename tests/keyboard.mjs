/**
 * Desktop shortcuts: what each key does, and when the app deliberately stays deaf.
 *
 * The keys are dispatched at the document rather than typed through the browser's input pipeline.
 * Two reasons: the app listens on `window` and a dispatched event is the same shape the listener
 * sees, while a real `/` or Ctrl+S would be handled by Chrome before the page ever got it — the
 * app can only decline to act, it cannot stop the browser, and that is worth testing rather than
 * working around.
 *
 * The media shim (see cdp.mjs) is what makes the play/pause half testable: a 1×1 PNG is not a
 * video, so elements are given a truthful `paused` and a `play`/`pause` pair that report through
 * the events the app listens for.
 *
 * Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
 */
import {
  check,
  connectToPage,
  installMediaShim,
  PNG,
  pressKey,
  report,
  setSearchText,
  sleep,
  stubApi,
  waitForSlides,
  watchPageErrors,
} from './lib/cdp.mjs'

const CDP_PORT = Number(process.env.CDP_PORT || 9334)
const APP = process.env.APP_URL || 'http://localhost:4173/'

const POSTS = [
  {
    id: 910701,
    rating: 'g',
    file_ext: 'mp4',
    file_size: 300000,
    image_width: 1280,
    image_height: 720,
    file_url: 'https://cdn.donmai.us/original/aa/bb/910701.mp4',
    large_file_url: 'https://cdn.donmai.us/original/aa/bb/910701.mp4',
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/910701.jpg',
    source_url: 'https://www.pixiv.net/en/artworks/910701',
    tag_string: '1girl solo',
    tag_count: 2,
    is_animated: true,
    media_asset: { id: 1, variants: [] },
  },
  {
    id: 910702,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 260000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/910702.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/aa/bb/910702.jpg',
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/910702.jpg',
    tag_string: '1girl solo',
    tag_count: 2,
    is_animated: false,
    media_asset: { id: 2, variants: [] },
  },
]

const boxValue = `document.querySelector('[role="combobox"]').value`
const liveText = `document.querySelector('[aria-live="polite"]').textContent ?? ''`
const title = `document.title`
const activeSlide = `(() => {
  const root = document.querySelector('[role="feed"]')
  return Math.round((root.scrollTop / root.clientHeight) * 100) / 100
})()`
const railLabel = (index) =>
  `document.querySelector('[data-slide][data-index="${index}"] [aria-label="Save"], [data-slide][data-index="${index}"] [aria-label="Remove from saved"]')?.getAttribute('aria-label') ?? ''`
const muteLabel = `document.querySelector('[aria-label="Mute"], [aria-label="Unmute"]')?.getAttribute('aria-label') ?? ''`
const dialogTitle = `document.querySelector('[role="dialog"]')?.querySelector('h2')?.textContent ?? ''`

/** Wait for the snap scroll to settle on a slide, since smooth scrolling takes a moment. */
async function waitForSlide(c, index, { tries = 25 } = {}) {
  for (let i = 0; i < tries; i++) {
    const at = await c.evalJS(activeSlide)
    if (Math.abs(at - index) < 0.02) return true
    await sleep(100)
  }
  return false
}

async function main() {
  const c = await connectToPage(CDP_PORT)
  const postCalls = []
  const pageErrors = watchPageErrors(c)

  // Before the first navigation: every document from here on gets the shim.
  await installMediaShim(c)

  const interceptor = await stubApi(c, [
    { match: 'donmai.us/posts.json', json: POSTS, record: postCalls },
    { match: 'donmai.us/autocomplete.json', json: [] },
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])

  await c.send('Page.navigate', { url: APP })
  check('two slides rendered', (await waitForSlides(c, 2)) === 2)
  await sleep(600)

  console.log('\n=== 1. moving between posts ===')
  check('the feed starts on the first post', Math.abs((await c.evalJS(activeSlide))) < 0.02, String(await c.evalJS(activeSlide)))
  await c.evalJS(pressKey('j'))
  check('j moves one post down', await waitForSlide(c, 1), String(await c.evalJS(activeSlide)))
  await c.evalJS(pressKey('k'))
  check('k moves back up', await waitForSlide(c, 0), String(await c.evalJS(activeSlide)))
  await c.evalJS(pressKey('ArrowDown'))
  check('the down arrow does the same', await waitForSlide(c, 1), String(await c.evalJS(activeSlide)))
  await c.evalJS(pressKey('ArrowUp'))
  check('and the up arrow', await waitForSlide(c, 0), String(await c.evalJS(activeSlide)))

  console.log('\n=== 2. space plays and pauses ===')
  check('the active video started on its own', (await c.evalJS(`document.querySelector('video')?.__paused`)) === false)
  await c.evalJS(pressKey(' '))
  await sleep(200)
  check('space pauses it', (await c.evalJS(`document.querySelector('video')?.__paused`)) === true)
  check('and says so', (await c.evalJS(liveText)).includes('Paused'), await c.evalJS(liveText))
  await c.evalJS(pressKey(' '))
  await sleep(200)
  check('space plays it again', (await c.evalJS(`document.querySelector('video')?.__paused`)) === false)
  check('and says so', (await c.evalJS(liveText)).includes('Playing'), await c.evalJS(liveText))

  console.log('\n=== 3. s saves, m mutes ===')
  check('nothing is saved yet', (await c.evalJS(railLabel(0))) === 'Save')
  await c.evalJS(pressKey('s'))
  await sleep(250)
  check('s saves the post on screen', (await c.evalJS(railLabel(0))) === 'Remove from saved', await c.evalJS(railLabel(0)))
  check('and says so', (await c.evalJS(liveText)).includes('Saved to your list'), await c.evalJS(liveText))
  await c.evalJS(pressKey('s'))
  await sleep(250)
  check('s again unsaves it', (await c.evalJS(railLabel(0))) === 'Save', await c.evalJS(railLabel(0)))

  // The rail's bookmark belongs to a slide, so this also proves `s` follows the scroll.
  await c.evalJS(pressKey('j'))
  await waitForSlide(c, 1)
  await c.evalJS(pressKey('s'))
  await sleep(250)
  check('s acts on the post that is on screen, not the first one', (await c.evalJS(railLabel(1))) === 'Remove from saved')
  check('the first slide is untouched', (await c.evalJS(railLabel(0))) === 'Save', await c.evalJS(railLabel(0)))
  await c.evalJS(pressKey('k'))
  await waitForSlide(c, 0)

  check('sound starts off', (await c.evalJS(muteLabel)) === 'Unmute', await c.evalJS(muteLabel))
  await c.evalJS(pressKey('m'))
  await sleep(200)
  check('m turns it on', (await c.evalJS(muteLabel)) === 'Mute', await c.evalJS(muteLabel))
  await c.evalJS(pressKey('m'))
  await sleep(200)
  check('and m again turns it back off', (await c.evalJS(muteLabel)) === 'Unmute')

  console.log('\n=== 4. o opens the original ===')
  await c.evalJS(`(() => {
    window.__opened = []
    window.open = (url) => { window.__opened.push(url); return null }
    return 'ok'
  })()`)
  await c.evalJS(pressKey('o'))
  await sleep(200)
  // `sourceUrl` is the post's own page for anything that came from the API: the artist's credit
  // and the comments live there, and the file itself is already on screen.
  check(
    'o opens the post page for the post on screen',
    (await c.evalJS(`window.__opened[0]`)) === 'https://danbooru.donmai.us/posts/910701',
    String(await c.evalJS(`window.__opened[0]`)),
  )
  await c.evalJS(pressKey('j'))
  await waitForSlide(c, 1)
  await c.evalJS(pressKey('o'))
  await sleep(200)
  check(
    'and follows the scroll',
    (await c.evalJS(`window.__opened[1]`)) === 'https://danbooru.donmai.us/posts/910702',
    String(await c.evalJS(`window.__opened[1]`)),
  )
  await c.evalJS(pressKey('k'))
  await waitForSlide(c, 0)

  console.log('\n=== 5. the browser keeps its own keys ===')
  await c.evalJS(pressKey('s', { ctrlKey: true }))
  await sleep(250)
  check('ctrl+s is not the app’s save', (await c.evalJS(railLabel(0))) === 'Save', await c.evalJS(railLabel(0)))
  await c.evalJS(
    pressKey('s', { metaKey: true }),
  )
  await sleep(250)
  check('and neither is command+s', (await c.evalJS(railLabel(0))) === 'Save')
  await c.evalJS(pressKey('s', { altKey: true }))
  await sleep(250)
  check('and neither is alt+s', (await c.evalJS(railLabel(0))) === 'Save')

  console.log('\n=== 6. restrained while typing ===')
  await c.evalJS(pressKey('/'))
  await sleep(200)
  check(
    'slash focuses the search box',
    (await c.evalJS(`document.activeElement === document.querySelector('[role="combobox"]')`)) === true,
  )
  const typedS = await c.evalJS(`(() => {
    const input = document.querySelector('[role="combobox"]')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    return 'ok'
  })()`)
  await sleep(250)
  check('s typed into the box is a letter, not a save', typedS === 'ok' && (await c.evalJS(railLabel(0))) === 'Save', await c.evalJS(railLabel(0)))
  const scrolledWhileFocused = await c.evalJS(`(() => {
    const root = document.querySelector('[role="feed"]')
    const input = document.querySelector('[role="combobox"]')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    return root.scrollTop
  })()`)
  await sleep(400)
  check('and the arrow keys still belong to the caret', scrolledWhileFocused === 0 && Math.abs(await c.evalJS(activeSlide)) < 0.02, String(await c.evalJS(activeSlide)))
  await c.evalJS(`document.activeElement.blur()`)

  console.log('\n=== 7. ? is the help screen ===')
  check('no dialog is open', (await c.evalJS(dialogTitle)) === '')
  await c.evalJS(pressKey('?'))
  await sleep(300)
  check('? opens the keyboard help', (await c.evalJS(dialogTitle)) === 'Keyboard', await c.evalJS(dialogTitle))
  check(
    'and it lists what the keys do',
    (await c.evalJS(`document.querySelector('[role="dialog"]').innerText`)).includes('Next and previous post'),
  )
  await c.evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(300)
  check('escape closes it', (await c.evalJS(dialogTitle)) === '', await c.evalJS(dialogTitle))
  await c.evalJS(`document.querySelector('[aria-label="Keyboard shortcuts"]').click()`)
  await sleep(300)
  check('the header button opens the same thing', (await c.evalJS(dialogTitle)) === 'Keyboard')
  await c.evalJS(`document.querySelector('[role="dialog"] [aria-label="Close"]').click()`)
  await sleep(300)

  console.log('\n=== 8. shortcuts stand down behind a sheet ===')
  await c.evalJS(`document.querySelector('[aria-label^="Settings"]').click()`)
  await sleep(350)
  check('the settings sheet is open', (await c.evalJS(dialogTitle)) === 'Settings', await c.evalJS(dialogTitle))
  const announcedBefore = await c.evalJS(liveText)
  await c.evalJS(pressKey('s'))
  await sleep(250)
  check('s does nothing while a sheet is in front', (await c.evalJS(railLabel(0))) === 'Save', await c.evalJS(railLabel(0)))
  check('and announces nothing new', (await c.evalJS(liveText)) === announcedBefore, await c.evalJS(liveText))
  await c.evalJS(pressKey(' '))
  await sleep(200)
  check('space does not drive the video behind it either', (await c.evalJS(`document.querySelector('video')?.__paused`)) === false)
  await c.evalJS(`document.querySelector('[role="dialog"] [aria-label="Close"]').click()`)
  await sleep(350)
  await c.evalJS(pressKey('s'))
  await sleep(250)
  check('and s is back as soon as the sheet closes', (await c.evalJS(railLabel(0))) === 'Remove from saved')
  await c.evalJS(pressKey('s'))
  await sleep(250)

  console.log('\n=== 9. h starts over ===')
  await c.evalJS(setSearchText('chun-li'))
  await sleep(1400)
  check('the search is showing', (await c.evalJS(boxValue)) === 'chun-li')
  check('and the tab says what it is', (await c.evalJS(title)) === 'chun-li — danfeed', await c.evalJS(title))
  const beforeHome = postCalls.length
  await c.evalJS(pressKey('h'))
  await sleep(800)
  check('h clears the search box', (await c.evalJS(boxValue)) === '', await c.evalJS(boxValue))
  check('h leaves the default search behind', (await c.evalJS(title)) === 'danfeed', await c.evalJS(title))
  check(
    'and reloads the default feed',
    postCalls.length > beforeHome && !decodeURIComponent(postCalls.at(-1)).includes('chun_li'),
    postCalls.at(-1),
  )
  check('the saved post from earlier is still saved', (await c.evalJS(railLabel(1))) === 'Remove from saved')

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
