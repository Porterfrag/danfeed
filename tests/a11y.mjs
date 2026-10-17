/**
 * Accessibility: reduced motion, the live region, the dialog contract, and the feed's structure.
 *
 * Two of these can only be tested by flipping a setting and watching the app change its mind, so
 * the suite does that: `prefers-reduced-motion` is emulated on, then off, in the same page. That
 * also tests the hook rather than the first read of it.
 *
 * The dialog checks are why this suite turns focus emulation on: headless Chrome gives the page
 * no system focus of its own, so a click never focuses a button and Tab never moves.
 *
 * Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
 */
import {
  check,
  connectToPage,
  installMediaShim,
  mouseClick,
  PNG,
  pressKey,
  report,
  setSearchText,
  sleep,
  stubApi,
  waitForSlides,
  watchPageErrors,
} from './lib/cdp.mjs'

const CDP_PORT = Number(process.env.CDP_PORT || 9338)
const APP = process.env.APP_URL || 'http://localhost:4173/'

const POSTS = [
  {
    id: 950901,
    rating: 'g',
    file_ext: 'mp4',
    file_size: 320000,
    image_width: 1280,
    image_height: 720,
    file_url: 'https://cdn.donmai.us/original/aa/bb/950901.mp4',
    large_file_url: 'https://cdn.donmai.us/original/aa/bb/950901.mp4',
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/950901.jpg',
    source_url: 'https://www.pixiv.net/en/artworks/950901',
    tag_string: '1girl solo',
    tag_count: 2,
    is_animated: true,
    media_asset: { id: 1, variants: [] },
  },
  {
    id: 950902,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 260000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/950902.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/aa/bb/950902.jpg',
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/950902.jpg',
    tag_string: '1girl solo',
    tag_count: 2,
    is_animated: false,
    media_asset: { id: 2, variants: [] },
  },
]

const activeSlide = `(() => {
  const root = document.querySelector('[role="feed"]')
  return Math.round((root.scrollTop / root.clientHeight) * 100) / 100
})()`
const liveText = `(document.querySelector('[aria-live="polite"]')?.textContent ?? '').replace(/\\u200b/g, '')`
const dialogInfo = `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) return null
  const label = dialog.getAttribute('aria-labelledby')
  return {
    name: label ? (document.getElementById(label)?.textContent ?? '') : '',
    modal: dialog.getAttribute('aria-modal'),
    focused: document.activeElement === dialog,
    animation: getComputedStyle(dialog).animationName,
  }
})()`

async function waitFor(c, expression, { tries = 40 } = {}) {
  for (let i = 0; i < tries; i++) {
    const value = await c.evalJS(expression)
    if (value) return value
    await sleep(150)
  }
  return null
}

async function tab(c) {
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  })
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  })
}

const REDUCED = { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }
const NORMAL = { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }

async function main() {
  const c = await connectToPage(CDP_PORT)
  const pageErrors = watchPageErrors(c)

  await installMediaShim(c)
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true })

  const interceptor = await stubApi(c, [
    // Ahead of the generic route: a search for chun-li is one post, the default feed is two, so
    // the announcement can be shown to belong to the search rather than to the first load. The
    // hyphens are the ones the box was typed with — the app passes them through as written.
    { match: 'chun-li', json: [POSTS[0]] },
    { match: 'donmai.us/posts.json', json: POSTS },
    { match: 'donmai.us/autocomplete.json', json: [] },
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])

  console.log('\n=== 1. less motion, asked for at the system level ===')
  await c.send('Emulation.setEmulatedMedia', REDUCED)
  await c.send('Page.navigate', { url: APP })
  check('two slides rendered', (await waitForSlides(c, 2)) === 2)
  await sleep(600)
  check(
    'the video did not start on its own',
    (await c.evalJS(`window.__playCalls`)) === 0,
    String(await c.evalJS(`window.__playCalls`)),
  )
  await c.evalJS(pressKey('j'))
  check(
    'j lands on the next post without gliding there',
    Math.abs((await c.evalJS(activeSlide)) - 1) < 0.02,
    String(await c.evalJS(activeSlide)),
  )
  await mouseClick(c, '[aria-label^="Settings"]')
  await sleep(400)
  check(
    'the sheet does not slide up',
    (await c.evalJS(dialogInfo)).animation === 'none',
    String((await c.evalJS(dialogInfo)).animation),
  )
  await c.evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(300)

  console.log('\n=== 2. and it is a preference, not a verdict ===')
  // Back to the video: which slide is showing is what decides whether anything plays.
  await c.evalJS(pressKey('k'))
  await sleep(300)
  await c.send('Emulation.setEmulatedMedia', NORMAL)
  check(
    'the video starts once motion is welcome',
    (await waitFor(c, `window.__playCalls > 0`)) === true,
    String(await c.evalJS(`window.__playCalls`)),
  )
  await mouseClick(c, '[aria-label^="Settings"]')
  await sleep(400)
  check(
    'and the sheet animates again',
    (await c.evalJS(dialogInfo)).animation === 'df-fade-up',
    String((await c.evalJS(dialogInfo)).animation),
  )

  console.log('\n=== 3. the sheet is a dialog ===')
  const sheet = await c.evalJS(dialogInfo)
  check('it names itself from its heading', sheet.name === 'Settings', JSON.stringify(sheet))
  check('it says it is modal', sheet.modal === 'true', JSON.stringify(sheet))
  check('focus moved into it', sheet.focused === true, JSON.stringify(sheet))
  check(
    'the feed behind it is inert',
    (await c.evalJS(`document.querySelector('[role="feed"]')?.closest('[inert]') !== null`)) === true,
  )
  const trail = []
  for (let i = 0; i < 12; i++) {
    await tab(c)
    trail.push(await c.evalJS(`!!document.activeElement?.closest('[role="dialog"]')`))
  }
  check('tab never leaves it', trail.every(Boolean), JSON.stringify(trail))
  await c.evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(350)
  check(
    'escape closes it and gives focus back to the button that opened it',
    (await c.evalJS(`document.activeElement?.getAttribute('aria-label') ?? ''`)).startsWith('Settings'),
    await c.evalJS(`document.activeElement?.getAttribute('aria-label')`),
  )

  console.log('\n=== 4. what the app says out loud ===')
  check(
    'there is one polite live region',
    (await c.evalJS(
      `!!document.querySelector('[aria-live="polite"][aria-atomic="true"]')`,
    )) === true,
  )
  check(
    'and it takes no space on screen',
    (await c.evalJS(`getComputedStyle(document.querySelector('[aria-live="polite"]')).width`)) === '1px',
  )
  check('the first load announced its count', (await c.evalJS(liveText)) === '2 posts', await c.evalJS(liveText))
  await c.evalJS(pressKey('s'))
  await sleep(300)
  check('saving says so', (await c.evalJS(liveText)) === 'Saved to your list', await c.evalJS(liveText))
  await c.evalJS(setSearchText('chun-li'))
  await sleep(1400)
  check('a search announces what came back', (await c.evalJS(liveText)) === '1 post', await c.evalJS(liveText))

  console.log('\n=== 5. the feed is a feed ===')
  // Back to the whole feed: a slide's position only means something next to its neighbours.
  await c.evalJS(pressKey('h'))
  check('the default feed is back', (await waitForSlides(c, 2)) === 2)
  check(
    'there is a main landmark around it',
    (await c.evalJS(`!!document.querySelector('main [role="feed"]')`)) === true,
  )
  check(
    'which is a labelled feed',
    (await c.evalJS(`document.querySelector('[role="feed"]')?.getAttribute('aria-label')`)) === 'Posts',
  )
  const slide = await c.evalJS(`(() => {
    const first = document.querySelector('[data-slide]')
    return {
      role: first?.getAttribute('role'),
      label: first?.getAttribute('aria-label'),
      pos: first?.getAttribute('aria-posinset'),
      size: first?.getAttribute('aria-setsize'),
    }
  })()`)
  check(
    'and its slides are labelled articles with a position in the set',
    slide.role === 'article' && slide.label === 'Post 1 of 2' && slide.pos === '1' && slide.size === '2',
    JSON.stringify(slide),
  )

  console.log('\n=== 6. links that leave the app ===')
  check(
    'the source link opens a new tab without handing over the referrer',
    (await c.evalJS(`(() => {
      const link = document.querySelector('[aria-label="Open original"]')
      return link ? link.tagName + '/' + link.getAttribute('target') + '/' + link.getAttribute('rel') : 'missing'
    })()`)) === 'A/_blank/noreferrer',
  )

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
