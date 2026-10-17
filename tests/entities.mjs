/**
 * Covers the browsable entity row: artist / character / copyright chips, their per-category
 * caps, de-duplication against the generic `#tag` row, and that tapping searches the exact tag.
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
const SPECS = [
  {
    id: 900101,
    artists: 'corn_kuten',
    characters: 'phoenix_reffaella',
    copyrights: 'zenless_zone_zero',
    general: '1girl solo brown_hair',
  },
  {
    id: 900102,
    artists: '',
    characters: 'narita_taishin_(umamusume)',
    copyrights: 'umamusume',
    general: '1girl horse_ears',
  },
  {
    id: 900103,
    artists: '',
    characters: '',
    copyrights: '',
    general: 'no_entities_here landscape',
  },
  {
    // Group picture: expects 5 chips shown and 5 counted into "+5".
    id: 900104,
    artists: 'a_one b_two c_three',
    characters: 'c_one c_two c_three c_four',
    copyrights: 'p_one p_two p_three',
    general: 'group_pic',
  },
]

const POSTS = SPECS.map((spec) => buildPost(spec))

const seen = []
const tagsOf = (url) => new URL(url).searchParams.get('tags') ?? null

const slideText = (i) => `(document.querySelectorAll('[data-slide]')[${i}]?.innerText ?? '')`
/**
 * Every *entity* chip in a slide: its aria label and its category dot's colour class.
 * General chips also start with "Show more", so the selector is narrowed to the three
 * entity families the row renders with a dot and a chevron.
 */
const slideChips = (i) => `Array.from(
  document.querySelectorAll('[data-slide]')[${i}]?.querySelectorAll(
    '[aria-label^="Show more by artist"], [aria-label^="Show more of character"], [aria-label^="Show more from"]'
  ) ?? []
).map(b => ({
  label: b.getAttribute('aria-label'),
  dot: (b.querySelector('span[aria-hidden]')?.className ?? '').match(/bg-[a-z]+-400/)?.[0] ?? null,
  isButton: b.tagName === 'BUTTON',
}))`

async function main() {
  const c = await connectToPage(CDP_PORT)
  const pageErrors = watchPageErrors(c)

  await stubApi(
    c,
    [
      { match: 'donmai.us/posts.json', json: POSTS, record: seen },
      { match: 'cdn.donmai.us', image: PNG },
    ],
    { requestStage: true },
  )

  await c.send('Page.navigate', { url: APP })
  await waitForSlides(c, POSTS.length)

  console.log('\n=== 0. precondition: clean browser ===')
  check(
    'fresh profile (safe rating on first request)',
    seen.length > 0 && tagsOf(seen[0]) === 'rating:general',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )

  console.log('\n=== 1. all three categories render, with Danbooru category colours ===')
  const chips0 = await c.evalJS(slideChips(0))
  check(
    'artist, character and copyright each get a chip',
    JSON.stringify(chips0.map((x) => x.label)) ===
      JSON.stringify([
        'Show more by artist corn kuten',
        'Show more of character phoenix reffaella',
        'Show more from zenless zone zero',
      ]),
    `got ${JSON.stringify(chips0.map((x) => x.label))}`,
  )
  check(
    'colours follow Danbooru: artist red, character green, copyright purple',
    JSON.stringify(chips0.map((x) => x.dot)) ===
      JSON.stringify(['bg-red-400', 'bg-green-400', 'bg-purple-400']),
    `got ${JSON.stringify(chips0.map((x) => x.dot))}`,
  )
  check('chips are real buttons', chips0.every((x) => x.isButton), JSON.stringify(chips0))

  console.log('\n=== 2. parenthetical character tags and missing categories ===')
  const chips1 = await c.evalJS(slideChips(1))
  check(
    'character with a parenthetical reads naturally',
    JSON.stringify(chips1.map((x) => x.label)) ===
      JSON.stringify(['Show more of character narita taishin (umamusume)', 'Show more from umamusume']),
    `got ${JSON.stringify(chips1.map((x) => x.label))}`,
  )
  check('no artist tag means no artist chip', !chips1.some((x) => x.label.includes('artist')))
  const chips2 = await c.evalJS(slideChips(2))
  check('post with no entities renders no chips', chips2.length === 0, `got ${JSON.stringify(chips2)}`)

  console.log('\n=== 3. caps are per category, so no category is starved ===')
  const chips3 = await c.evalJS(slideChips(3))
  const kinds3 = chips3.map((x) => x.label.split(' ')[3])
  check('5 chips shown (2 artist + 2 character + 1 copyright)', chips3.length === 5, `got ${chips3.length}`)
  check(
    'copyright survives the cap despite 3 of them',
    JSON.stringify(chips3.filter((x) => x.dot === 'bg-purple-400').map((x) => x.label)) ===
      JSON.stringify(['Show more from p one']),
    `got ${JSON.stringify(chips3.map((x) => x.label))}`,
  )
  check(
    'each category represented',
    new Set(kinds3).size === 3,
    `kinds=${JSON.stringify(kinds3)}`,
  )
  const text3 = await c.evalJS(slideText(3))
  check('overflow counted: +5 hidden', text3.includes('+5'), text3.replace(/\n/g, ' | '))

  console.log('\n=== 4. nothing is shown twice ===')
  const text0 = await c.evalJS(slideText(0))
  for (const tag of ['corn_kuten', 'phoenix_reffaella', 'zenless_zone_zero']) {
    check(`#${tag} removed from the generic tag row`, !text0.includes(`#${tag}`), text0)
  }
  check('general tags still shown as #chips', text0.includes('#1girl'), text0)
  const text1 = await c.evalJS(slideText(1))
  check(
    'parenthetical character also removed from the tag row',
    !text1.includes('#narita_taishin_'),
    text1,
  )

  console.log('\n=== 5. tapping searches the exact tag, per category ===')
  seen.length = 0
  await c.evalJS(`document.querySelector('[aria-label="Show more of character phoenix reffaella"]').click()`)
  await sleep(1200)
  check(
    'character tap searches the character tag',
    seen.length > 0 && tagsOf(seen[0]) === 'rating:general phoenix_reffaella',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )

  seen.length = 0
  await c.evalJS(`document.querySelector('[aria-label="Show more from zenless zone zero"]').click()`)
  await sleep(1200)
  check(
    'copyright tap searches the copyright tag',
    seen.length > 0 && tagsOf(seen[0]) === 'rating:general zenless_zone_zero',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )

  seen.length = 0
  await c.evalJS(
    `document.querySelector('[aria-label="Show more of character narita taishin (umamusume)"]').click()`,
  )
  await sleep(1200)
  check(
    'parenthetical character searches with underscores intact',
    seen.length > 0 && tagsOf(seen[0]) === 'rating:general narita_taishin_(umamusume)',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )

  seen.length = 0
  await c.evalJS(
    `document.querySelector('[aria-label="Show more by artist corn kuten"]').click()`,
  )
  await sleep(1200)
  check(
    'artist tap still works after the rewrite',
    seen.length > 0 && tagsOf(seen[0]) === 'rating:general corn_kuten',
    `got ${JSON.stringify(seen.map(tagsOf))}`,
  )
  const box = await c.evalJS(`document.querySelector('[role="combobox"]').value`)
  check('exact tag left in the search box', box === 'corn_kuten', `got ${JSON.stringify(box)}`)

  console.log('\n=== 6. saved items from before this feature still work ===')
  // Written by an older build: no artists, characters or copyrights fields at all.
  const legacy = {
    key: 'danbooru:777777',
    kind: 'photo',
    src: 'https://cdn.donmai.us/sample/aa/bb/sample-777777.jpg',
    poster: 'https://cdn.donmai.us/180x180/aa/bb/777777.jpg',
    width: 1000,
    height: 1500,
    rating: 'g',
    score: 5,
    tags: ['1girl', 'solo'],
    origin: 'danbooru',
    postId: 777777,
  }
  await c.evalJS(`localStorage.setItem('danfeed.saved.v1', ${JSON.stringify(JSON.stringify([legacy]))})`)
  pageErrors.length = 0
  await c.send('Page.navigate', { url: APP })
  await waitForSlides(c, 1)
  await c.evalJS(`document.querySelector('[aria-label="Saved"]').click()`)
  await sleep(400)
  await c.evalJS(`document.querySelector('[aria-label="Play"]').click()`)
  await sleep(900)
  const rendered = await c.evalJS(`document.querySelectorAll('[data-slide]').length`)
  check('legacy saved item plays', rendered > 0, `slides=${rendered}`)
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
  const legacyChips = await c.evalJS(slideChips(0))
  check('legacy item shows no entity chips', legacyChips.length === 0, `got ${JSON.stringify(legacyChips)}`)

  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
