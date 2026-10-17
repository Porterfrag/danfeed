/**
 * Covers the general tag row: meta tags kept out of it, chips that search on one tap, the
 * expanded hit area, and the all-tags sheet behind "+N".
 *
 * Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
 */
import {
  check,
  connectToPage,
  PNG,
  report,
  sleep,
  stubApi,
  waitForSlides,
  watchPageErrors,
} from './lib/cdp.mjs'
import { buildPost } from './lib/fixtures.mjs'

const CDP_PORT = Number(process.env.CDP_PORT || 9333)
const APP = process.env.APP_URL || 'http://localhost:4173/'
const POSTS = [
  // The common case: 7 general tags and 3 meta ones.
  buildPost({
    id: 910001,
    artists: 'corn_kuten',
    characters: 'phoenix_reffaella',
    copyrights: 'zenless_zone_zero',
    general: '1girl ahoge apron blue_dress blue_hairband blonde_hair blush',
    meta: 'absurdres highres commentary_request',
  }),
  // Fewer than five general tags, so only meta is hidden. "+N" must still appear or meta
  // would be unreachable.
  buildPost({ id: 910002, general: '1girl solo', meta: 'highres bad_id' }),
  // Nothing hidden in either row: no "+N" and so no way in, which is fine.
  buildPost({ id: 910003, general: '1girl solo', meta: '' }),
  // Entity overflow, so the entity row's own "+N" has to reach the sheet too.
  buildPost({
    id: 910004,
    artists: 'a_one b_two c_three',
    general: 'one_tag two_tag',
    meta: '',
  }),
]
const postCalls = []
const panelOpen = `!!document.getElementById('tag-suggestions')`
const sheetTitle = `document.querySelector('h2')?.textContent ?? ''`
const boxValue = `document.querySelector('[role="combobox"]').value`

const slide = (i, selector) =>
  `Array.from(document.querySelectorAll('[data-slide]')[${i}]?.querySelectorAll(${JSON.stringify(selector)}) ?? [])`
const generalChips = (i) => `${slide(i, '[aria-label^="Show more with tag "]')}.map(b => b.innerText)`
const allTagsButtons = (i) => `${slide(i, '[aria-label="Show all tags"]')}.length`
/** Rows inside the open sheet. The sheet renders at the app root, not inside a slide. */
const chipLabels = () =>
  `Array.from(document.querySelectorAll('[aria-label^="Search "]')).map(b => b.getAttribute('aria-label'))`

/** Is the pill still the hit target this far above its own top edge? */
const hitsAt = (i, dy) => `(() => {
  const b = document.querySelectorAll('[data-slide]')[${i}]?.querySelector('[aria-label^="Show more with tag "]')
  if (!b) return 'no chip'
  const r = b.getBoundingClientRect()
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + ${dy})
  if (!el) return 'none'
  return el.closest('[aria-label^="Show more with tag "]') ? 'chip' : el.tagName
})()`

async function main() {
  const c = await connectToPage(CDP_PORT)
  const pageErrors = watchPageErrors(c)

  await stubApi(c, [
    // No suggestions for these, so a panel opening would be the bug, not a stub.
    { match: '/autocomplete.json', json: [] },
    { match: '/posts.json', json: POSTS, record: postCalls },
    { match: 'cdn.donmai.us', image: PNG },
  ])

  await c.send('Page.navigate', { url: APP })
  await waitForSlides(c, POSTS.length)
  await sleep(400)

  console.log('\n=== 1. meta tags are kept out of the row ===')
  const text0 = await c.evalJS(`document.querySelectorAll('[data-slide]')[0].innerText`)
  for (const meta of ['absurdres', 'highres', 'commentary_request']) {
    check(`${meta} not in the slide row`, !text0.includes(meta), text0.replace(/\n/g, ' | '))
  }
  check('entities still get their own chips', text0.includes('corn kuten'), text0)

  console.log('\n=== 2. the row shows five general tags and counts the rest ===')
  check(
    'exactly five general chips',
    JSON.stringify(await c.evalJS(generalChips(0))) ===
      JSON.stringify([
        '#1girl',
        '#ahoge',
        '#apron',
        '#blue_dress',
        '#blue_hairband',
      ]),
    JSON.stringify(await c.evalJS(generalChips(0))),
  )
  // 7 general - 5 shown = 2, plus all 3 meta = 5
  check('+N counts hidden general plus meta', text0.includes('+5'), text0.replace(/\n/g, ' | '))

  console.log('\n=== 3. the pill is small but the hit area is not ===')
  const box = await c.evalJS(
    `(() => { const r = document.querySelectorAll('[data-slide]')[0].querySelector('[aria-label^="Show more with tag "]').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()`,
  )
  check('pill is around 25px tall', box.h >= 24, JSON.stringify(box))
  check('3px above still hits the chip', (await c.evalJS(hitsAt(0, -3))) === 'chip', await c.evalJS(hitsAt(0, -3)))
  check(
    '6px above is outside the hit area',
    (await c.evalJS(hitsAt(0, -6))) !== 'chip',
    await c.evalJS(hitsAt(0, -6)),
  )

  console.log('\n=== 4. one tap searches the exact tag, without the suggestion panel ===')
  postCalls.length = 0
  await c.evalJS(`document.querySelectorAll('[data-slide]')[0].querySelector('[aria-label="Show more with tag blue dress"]').click()`)
  await sleep(1600)
  const tags = postCalls.map((u) => decodeURIComponent(new URL(u).searchParams.get('tags')))
  check(
    'searched the underscored tag',
    tags.length > 0 && tags[0] === 'rating:general blue_dress',
    JSON.stringify(tags),
  )
  check('no suggestion panel over the feed', !(await c.evalJS(panelOpen)))
  check(
    'tag is in the search box',
    (await c.evalJS(boxValue)) === 'blue_dress',
    JSON.stringify(await c.evalJS(boxValue)),
  )

  console.log('\n=== 5. "+N" opens every tag ===')
  await c.send('Page.navigate', { url: APP })
  for (let i = 0; i < 80; i++) {
    const n = await c.evalJS(`document.querySelectorAll('[data-slide]').length`)
    if (n >= POSTS.length) break
    await sleep(250)
  }
  await sleep(400)
  await c.evalJS(`document.querySelectorAll('[data-slide]')[0].querySelector('[aria-label="Show all tags"]').click()`)
  await sleep(500)
  check(
    'sheet opened for the right post',
    (await c.evalJS(sheetTitle)).startsWith('Tags · #910001'),
    JSON.stringify(await c.evalJS(sheetTitle)),
  )
  const labels = await c.evalJS(chipLabels())
  check(
    'every tag is listed, meta included',
    [
      'Search corn kuten',
      'Search phoenix reffaella',
      'Search zenless zone zero',
      'Search 1girl',
      'Search blonde hair',
      'Search blue dress',
      'Search absurdres',
      'Search highres',
      'Search commentary request',
    ].every((l) => labels.includes(l)),
    JSON.stringify(labels),
  )
  check('13 tags in total', labels.length === 13, `got ${labels.length}`)
  const rowHeight = await c.evalJS(
    `Math.round(document.querySelector('[aria-label="Search blue dress"]').getBoundingClientRect().height)`,
  )
  check('rows are 44px tall', rowHeight >= 44, `got ${rowHeight}`)
  const metaHeading = await c.evalJS(
    `Array.from(document.querySelectorAll('h3')).map(h => h.innerText.replace(/\\s+/g, '').toLowerCase())`,
  )
  check(
    'grouped by family, in order',
    JSON.stringify(metaHeading) ===
      JSON.stringify(['artist1', 'character1', 'series1', 'general7', 'meta3']),
    JSON.stringify(metaHeading),
  )

  console.log('\n=== 6. picking a row searches it and closes the sheet ===')
  postCalls.length = 0
  await c.evalJS(`document.querySelector('[aria-label="Search blonde hair"]').click()`)
  await sleep(1600)
  const picked = postCalls.map((u) => decodeURIComponent(new URL(u).searchParams.get('tags')))
  check(
    'searched the underscored tag',
    picked.length > 0 && picked[0] === 'rating:general blonde_hair',
    JSON.stringify(picked),
  )
  check('sheet closed', (await c.evalJS(sheetTitle)) === '', JSON.stringify(await c.evalJS(sheetTitle)))

  console.log('\n=== 7. a post with only meta hidden still has a way in ===')
  const chips1 = await c.evalJS(generalChips(1))
  check('two general chips shown', chips1.length === 2, JSON.stringify(chips1))
  check('"+N" present for the two meta tags', (await c.evalJS(allTagsButtons(1))) === 1)
  const text1 = await c.evalJS(`document.querySelectorAll('[data-slide]')[1].innerText`)
  check('+2, not +0', text1.includes('+2') && !text1.includes('+0'), text1.replace(/\n/g, ' | '))
  check(
    'nothing hidden means no "+N" at all',
    (await c.evalJS(allTagsButtons(2))) === 0,
    `got ${await c.evalJS(allTagsButtons(2))}`,
  )

  console.log('\n=== 8. the entity row overflows into the same sheet ===')
  check(
    'entity overflow has its own "+N"',
    (await c.evalJS(slide(3, '[aria-label="Show all tags"]').concat('.length'))) === 1,
    await c.evalJS(slide(3, '[aria-label="Show all tags"]').concat('.length')),
  )
  await c.evalJS(`document.querySelectorAll('[data-slide]')[3].querySelector('[aria-label="Show all tags"]').click()`)
  await sleep(500)
  check(
    'sheet opened from the entity row',
    (await c.evalJS(sheetTitle)).startsWith('Tags · #910004'),
    JSON.stringify(await c.evalJS(sheetTitle)),
  )
  const labels3 = await c.evalJS(chipLabels())
  check(
    'the artist that did not fit is reachable',
    labels3.includes('Search c three'),
    JSON.stringify(labels3),
  )

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
