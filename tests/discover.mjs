/**
 * Speculative discovery: what the app fetches before it is asked, and how it finds more of what
 * is in front.
 *
 * Two halves. The feed asks for the next page once a few slides are left instead of waiting for
 * the sentinel at the bottom, so the boundary is crossed with the page already landed. And a
 * slide can be explored sideways: "More like this" lists what Danbooru says usually appears
 * alongside the post's artist (or character, or series), every row a search away.
 *
 * The speculation has a gate, and this suite is mostly about that gate: nothing is asked for
 * until the sheet has been opened once in this browser, and after that, only ever for the slide
 * that is actually in front. Related answers are cached for the session, failures are not, and
 * the sentinel at the bottom of the feed must not be what fetched the second page.
 *
 * Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
 */
import {
  check,
  connectToPage,
  PNG,
  pressKey,
  report,
  sleep,
  stubApi,
  waitForSlides,
  watchPageErrors,
} from './lib/cdp.mjs'
import { buildPost } from './lib/fixtures.mjs'

const CDP_PORT = Number(process.env.CDP_PORT || 9338)
const APP = process.env.APP_URL || 'http://localhost:4173/'

/** Twenty posts on the first page, so the app has a cursor to fetch ahead with. */
const PAGE1 = (() => {
  // The first six slides each carry something the suite looks for. The rest are filler, which is
  // also what makes "the slide in front is the only one warmed" observable: not one of them has
  // an artist, a character or a series to warm.
  const subjects = [
    { general: '1girl', artists: 'corn_kuten' },
    { general: '1girl solo', artists: 'a_one' },
    { general: '1girl', characters: 'c_two' },
    { general: '1girl solo' },
    { general: 'blue_dress', copyrights: 'p_one' },
    { general: '1girl', artists: 'obscure_artist' },
  ]
  return Array.from({ length: 20 }, (_, i) => buildPost({ id: 1000 - i, ...(subjects[i] ?? {}) }))
})()

/** Short enough that the search runs out after it. */
const PAGE2 = [100, 99, 98].map((id) => buildPost({ id, general: '1girl solo' }))

/** One row of `related_tag.json`, in the shape the live endpoint answers with. */
function row(name, category, frequency, postCount = 1000, deprecated = false) {
  return {
    tag: {
      id: 1,
      name,
      category,
      post_count: postCount,
      is_deprecated: deprecated,
      words: name.split('_'),
    },
    cosine_similarity: frequency,
    jaccard_similarity: frequency / 10,
    overlap_coefficient: frequency,
    frequency,
  }
}

const related = (rows) => ({
  query: 'x',
  post_count: 645,
  tag: null,
  related_tags: rows,
  wiki_page_tags: [],
})

/** What Danbooru really sends for an artist: the tag itself first, meta tags riding along. */
const CORN = related([
  row('corn_kuten', 1, 1, 645),
  row('commentary_request', 5, 0.82, 6438530),
  row('long_hair', 0, 0.69, 6319158),
  row('open_mouth', 0, 0.68, 5000000),
  row('blue_dress', 0, 0.42, 42150),
  row('old_name', 0, 0.4, 900, true),
  row('highres', 5, 0.5, 8330645),
])
const A_ONE = related([row('a_one', 1, 1, 300), row('c_two', 4, 0.55, 3000), row('smile', 0, 0.4, 900000)])
const C_TWO = related([])
const P_ONE = related([row('p_one', 3, 1, 8000), row('cosplay', 0, 0.3, 500000)])
const BLUE_DRESS = related([row('blue_dress', 0, 1, 42150), row('dress', 0, 0.6, 900000), row('ribbon', 0, 0.35, 400000)])
const OBSCURE = related([row('obscure_artist', 1, 1, 300), row('sketch', 0, 0.4, 20000)])

const bodyText = `document.body.innerText`
/** The topmost sheet: the related list can be opened over the actions sheet. */
const top = `Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) ?? null`
const topTitle = `(${top})?.querySelector('h2')?.textContent ?? ''`
const topText = `(${top})?.innerText ?? ''`
const topRows = `Array.from((${top})?.querySelectorAll('[aria-label^="Search "]') ?? []).map((b) => b.getAttribute('aria-label'))`
const dialogCount = `document.querySelectorAll('[role="dialog"]').length`
const closeTop = `(() => {
  const button = (${top})?.querySelector('[aria-label="Close"]')
  if (!button) return 'missing'
  button.click()
  return 'closed'
})()`
const moreButton = (posinset) =>
  `document.querySelector('[data-slide][aria-posinset="${posinset}"] [aria-label="More like this"]')`
const openMore = (posinset) => `(() => {
  const button = ${moreButton(posinset)}
  if (!button) return 'missing'
  button.click()
  return 'clicked'
})()`

/** A hold on a chip, the gesture that opens the tag actions sheet. */
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
const releaseChip = (selector) => `(() => {
  const chip = document.querySelector(${JSON.stringify(selector)})
  chip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0 }))
  return 'released'
})()`

/** Scroll so that slide `index` owns the screen, and report the geometry as it lands. */
const scrollToSlide = (index) => `(() => {
  const root = document.querySelector('[role="feed"]')
  root.scrollTop = root.clientHeight * ${index}
  return {
    top: root.scrollTop,
    slideHeight: root.clientHeight,
    below: root.scrollHeight - root.scrollTop - root.clientHeight,
  }
})()`

async function main() {
  const c = await connectToPage(CDP_PORT)
  const pageErrors = watchPageErrors(c)

  // Instant scrolling: this suite is about when requests go out, not about how the feed glides.
  await c.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })

  /** Every posts request, and every related-tag request, across every restub below. */
  const pages = []
  const relatedCalls = []
  let interceptor = null

  /** How many requests asked for one tag's related list. */
  const askedFor = (tag) => relatedCalls.filter((url) => url.includes(`query=${tag}`)).length
  /** Page requests that carried a cursor — i.e. anything past the first page. */
  const cursored = () => pages.filter((url) => url.includes('id%3A%3C')).length

  async function restub(routes) {
    if (interceptor) c.off(interceptor)
    interceptor = await stubApi(c, routes)
  }

  /**
   * The full route table. The cursor route is first and specific: a page-two request is the only
   * one whose tags parameter carries `id:<…`, and both pages must stay distinguishable.
   */
  const routes = (obscure = { fail: 9, status: 500 }) => [
    { match: 'id%3A%3C', json: PAGE2, record: pages },
    { match: 'donmai.us/posts.json', json: PAGE1, record: pages },
    { match: 'donmai.us/autocomplete.json', json: [] },
    { match: 'related_tag.json?query=corn_kuten', json: CORN, record: relatedCalls },
    { match: 'related_tag.json?query=a_one', json: A_ONE, record: relatedCalls },
    { match: 'related_tag.json?query=c_two', json: C_TWO, record: relatedCalls },
    { match: 'related_tag.json?query=p_one', json: P_ONE, record: relatedCalls },
    { match: 'related_tag.json?query=blue_dress', json: BLUE_DRESS, record: relatedCalls },
    { match: 'related_tag.json?query=obscure_artist', json: OBSCURE, record: relatedCalls, ...obscure },
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ]

  /** Poll a page-side expression until it is truthy. */
  async function waitFor(expression, { tries = 40 } = {}) {
    for (let i = 0; i < tries; i++) {
      if (await c.evalJS(expression)) return true
      await sleep(150)
    }
    return false
  }

  await restub(routes())
  await c.send('Page.navigate', { url: APP })
  check('twenty slides rendered', (await waitForSlides(c, 20)) === 20)

  console.log('\n=== 1. nothing is speculated before the feature has been used ===')
  await sleep(900)
  check('the first page was not chased with a cursor request', cursored() === 0, String(cursored()))
  check(
    'and no related list was asked for while the feed sat still',
    relatedCalls.length === 0,
    JSON.stringify(relatedCalls),
  )
  check('the slide on screen offers more like this', (await c.evalJS(`${moreButton(1)} !== null`)))

  console.log('\n=== 2. the sheet, and what Danbooru says is related ===')
  check('the button opens it', (await c.evalJS(openMore(1))) === 'clicked')
  check('the sheet appears', await waitFor(`(${top})?.querySelector('h2')?.textContent === 'More like this'`))
  check('its answer arrives', await waitFor(`JSON.stringify(${topRows}).includes('long hair')`))
  const opening = await c.evalJS(topText)
  check(
    'and says what it is about',
    opening.includes('alongside the artist corn kuten'),
    opening.slice(0, 120),
  )
  check(
    'the tag itself, meta tags and deprecated tags are left out',
    JSON.stringify(await c.evalJS(topRows)) ===
      JSON.stringify(['Search long hair', 'Search open mouth', 'Search blue dress']),
    JSON.stringify(await c.evalJS(topRows)),
  )
  check('rows say how much of the gallery carries the tag', opening.includes('in 69% of corn kuten'), opening)
  check('and how many posts it has', opening.includes('6.3M posts'), opening)
  check('the answer was asked for once', askedFor('corn_kuten') === 1, String(askedFor('corn_kuten')))

  console.log('\n=== 3. reopening is answered from the session cache ===')
  check('the sheet closes', (await c.evalJS(closeTop)) === 'closed')
  check('and is gone', (await c.evalJS(dialogCount)) === 0)
  await c.evalJS(openMore(1))
  check(
    'reopening shows the rows again',
    await waitFor(`JSON.stringify(${topRows}).includes('long hair')`),
  )
  check('without asking Danbooru again', askedFor('corn_kuten') === 1, String(askedFor('corn_kuten')))
  check('and with no loading line on screen', !(await c.evalJS(topText)).includes('Looking for'), await c.evalJS(topText))

  console.log('\n=== 4. the slide in front is warmed, once the sheet has been used ===')
  await c.evalJS(closeTop)
  await c.evalJS(pressKey('j'))
  await sleep(1200)
  check('the next slide was asked for in the background', askedFor('a_one') === 1, String(askedFor('a_one')))
  check('and the slide that left was not asked for again', askedFor('corn_kuten') === 1, String(askedFor('corn_kuten')))
  await c.evalJS(openMore(2))
  check('the sheet opens on the warm answer', await waitFor(`JSON.stringify(${topRows}).includes('c two')`))
  check(
    'and the rows are the ones Danbooru gave',
    JSON.stringify(await c.evalJS(topRows)) === JSON.stringify(['Search c two', 'Search smile']),
    JSON.stringify(await c.evalJS(topRows)),
  )
  check('a warm answer is not fetched twice', askedFor('a_one') === 1, String(askedFor('a_one')))
  check(
    'and the sheet names the artist this time',
    (await c.evalJS(topText)).includes('alongside the artist a one'),
  )

  console.log('\n=== 5. a character is a subject too, and an empty answer is an answer ===')
  await c.evalJS(closeTop)
  await c.evalJS(pressKey('j'))
  await sleep(200)
  await c.evalJS(openMore(3))
  check('the fallback subject is the character', await waitFor(`(${topText}).includes('alongside the character c two')`))
  check('with no artist on the post', (await c.evalJS(topRows)).length === 0)
  check(
    'nothing related is said plainly',
    await waitFor(`(${topText}).includes('Nothing is related to c two yet.')`),
    await c.evalJS(topText),
  )
  await c.evalJS(closeTop)
  await c.evalJS(openMore(3))
  await sleep(400)
  check('and an empty answer is not asked for twice', askedFor('c_two') === 1, String(askedFor('c_two')))

  console.log('\n=== 6. a slide with nothing to relate to offers no button ===')
  const beforeEmpty = relatedCalls.length
  await c.evalJS(closeTop)
  await c.evalJS(pressKey('j'))
  await sleep(900)
  check(
    'the slide carries no artist, character or series',
    (await c.evalJS(`document.querySelector('[data-slide][aria-posinset="4"] [aria-label^="Show more by artist"], [data-slide][aria-posinset="4"] [aria-label^="Show more of character"], [data-slide][aria-posinset="4"] [aria-label^="Show more from"]') === null`)),
  )
  check('there is no more-like-this button on it', (await c.evalJS(`${moreButton(4)} === null`)))
  check('and nothing was asked for', relatedCalls.length === beforeEmpty, JSON.stringify(relatedCalls))

  console.log('\n=== 7. and a series is the last fallback ===')
  await c.evalJS(pressKey('j'))
  await sleep(200)
  await c.evalJS(openMore(5))
  check('the subject is the series', await waitFor(`(${topText}).includes('alongside the series p one')`))
  check('with its own related list', await waitFor(`JSON.stringify(${topRows}).includes('cosplay')`))
  check(
    'and only the one row Danbooru gave',
    JSON.stringify(await c.evalJS(topRows)) === JSON.stringify(['Search cosplay']),
    JSON.stringify(await c.evalJS(topRows)),
  )

  console.log('\n=== 8. any tag can be explored, from the actions sheet ===')
  await c.evalJS(closeTop)
  const chip = '[data-slide][aria-posinset="5"] [aria-label="Show more with tag blue dress"]'
  check('the chip says it has a popup', (await c.evalJS(`document.querySelector('${chip}').getAttribute('aria-haspopup')`)) === 'dialog')
  check('the hold starts', (await c.evalJS(holdDown(chip))) === 'down')
  await sleep(650)
  check('the actions sheet opens', (await c.evalJS(topTitle)) === '#blue dress', await c.evalJS(topTitle))
  await c.evalJS(releaseChip(chip))
  const moreRow = `(() => {
    const button = Array.from((${top})?.querySelectorAll('button') ?? [])
      .find((b) => b.getAttribute('aria-label')?.startsWith('More like this:'))
    if (!button) return 'missing'
    button.click()
    return button.getAttribute('aria-label')
  })()`
  check(
    'the sheet offers the same list for any tag',
    (await c.evalJS(moreRow)) === 'More like this: tags that go with blue dress',
    await c.evalJS(moreRow),
  )
  check('the related sheet stacks over it', (await c.evalJS(dialogCount)) === 2, String(await c.evalJS(dialogCount)))
  check('named for the tag rather than an artist', (await c.evalJS(topText)).includes('alongside the tag blue dress'), await c.evalJS(topText))
  check('its neighbours arrive', await waitFor(`JSON.stringify(${topRows}).includes('ribbon')`))
  check(
    'and they are the ones Danbooru gave',
    JSON.stringify(await c.evalJS(topRows)) === JSON.stringify(['Search dress', 'Search ribbon']),
    JSON.stringify(await c.evalJS(topRows)),
  )
  check('asked for once', askedFor('blue_dress') === 1, String(askedFor('blue_dress')))
  await c.evalJS(pressKey('Escape'))
  await sleep(200)
  check('escape returns to the actions sheet', (await c.evalJS(topTitle)) === '#blue dress', await c.evalJS(topTitle))
  await c.evalJS(pressKey('Escape'))
  await sleep(200)
  check('and again closes the rest', (await c.evalJS(dialogCount)) === 0)

  console.log('\n=== 9. a failed lookup says so, and can be tried again ===')
  await c.evalJS(pressKey('j'))
  await sleep(200)
  await c.evalJS(openMore(6))
  check('the failure reaches the sheet', await waitFor(`(${topText}).includes('Try again')`), await c.evalJS(topText))
  check(
    'with what the API said and how many times it tried',
    (await c.evalJS(topText)).includes('having a moment') && (await c.evalJS(topText)).includes('Tried 3 times.'),
    await c.evalJS(topText),
  )
  const beforeRetry = askedFor('obscure_artist')
  check('three asks were made', beforeRetry === 3, String(beforeRetry))
  await restub(routes({}))
  const retryClick = `(() => {
    const button = Array.from((${top})?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent.trim() === 'Try again')
    if (!button) return 'missing'
    button.click()
    return 'clicked'
  })()`
  check('the failure offers a way back', (await c.evalJS(retryClick)) === 'clicked')
  check(
    'a failure is not cached: trying again really asks',
    await waitFor(`JSON.stringify(${topRows}).includes('sketch')`),
  )
  check('the retry was one more request', askedFor('obscure_artist') === beforeRetry + 1, String(askedFor('obscure_artist')))
  check('and the message is gone', !(await c.evalJS(topText)).includes('moment'))

  console.log('\n=== 10. the next page is fetched before the bottom is reached ===')
  await c.evalJS(closeTop)
  await c.send('Page.navigate', { url: APP })
  check('twenty slides rendered again', (await waitForSlides(c, 20)) === 20)
  check('still without a cursor request', cursored() === 0, String(cursored()))
  const geometry = await c.evalJS(scrollToSlide(17))
  check(
    'the jump landed on the eighteenth slide',
    Math.round(geometry.top / geometry.slideHeight) === 17 && geometry.slideHeight > 0,
    JSON.stringify(geometry),
  )
  check(
    'with the bottom of the feed out of the sentinel\'s reach',
    geometry.below > 800,
    JSON.stringify(geometry),
  )
  check('the next page arrived anyway', (await waitForSlides(c, 23)) === 23)
  check('as a cursor request', cursored() === 1, String(cursored()))
  await sleep(900)
  check('and it stopped there', cursored() === 1, String(cursored()))

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  if (interceptor) c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
