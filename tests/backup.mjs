/**
 * Backup and restore, end to end.
 *
 * The export is a real download — Chrome writes it to a temp directory and the suite reads what
 * actually landed there — and the restore goes in through the same hidden file input a person's
 * file picker feeds. Both halves are asserted, because either can look fine on its own while the
 * pair is broken.
 *
 * Run by tests/run.mjs against the production build, with Danbooru stubbed over CDP.
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const CDP_PORT = Number(process.env.CDP_PORT || 9333)
const APP = process.env.APP_URL || 'http://localhost:4173/'
const POST_ID = 900501
const POSTS = [
  {
    id: POST_ID,
    rating: 'g',
    file_ext: 'jpg',
    file_size: 320000,
    image_width: 1200,
    image_height: 1600,
    file_url: 'https://cdn.donmai.us/original/aa/bb/900501.jpg',
    large_file_url: 'https://cdn.donmai.us/sample/aa/bb/sample-900501.jpg',
    preview_file_url: 'https://cdn.donmai.us/180x180/aa/bb/900501.jpg',
    tag_string: '1girl solo',
    tag_count: 2,
    is_animated: false,
    media_asset: { id: 1, variants: [] },
  },
]

const savedCount = `(document.body.innerText.match(/[0-9]+ items/) || [''])[0]`
const railSaved = `!!document.querySelector('[aria-label="Remove from saved"]')`
const gearLabel = `document.querySelector('[aria-label^="Settings"]').getAttribute('aria-label')`
const bodyText = `document.body.innerText`

/** Wait for a finished download; `.crdownload` is the half-written one. */
async function waitForDownload(dir, { tries = 40 } = {}) {
  for (let i = 0; i < tries; i++) {
    const found = readdirSync(dir).find((name) => name.endsWith('.json'))
    if (found) return join(dir, found)
    await sleep(250)
  }
  return ''
}

async function openSettings(c) {
  await c.evalJS(`document.querySelector('[aria-label^="Settings"]').click()`)
  await sleep(350)
}

async function closeSheet(c) {
  await c.evalJS(`document.querySelector('[aria-label="Close"]').click()`)
  await sleep(300)
}

/** Hand a file to the sheet's input, exactly as the file picker would. */
async function pickFile(c, path) {
  const { root } = await c.send('DOM.getDocument')
  const { nodeId } = await c.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[aria-label="Backup file"]',
  })
  if (!nodeId) throw new Error('backup file input not found — is the settings sheet open?')
  await c.send('DOM.setFileInputFiles', { files: [path], nodeId })
  await sleep(500)
}

async function main() {
  const c = await connectToPage(CDP_PORT)
  const pageErrors = watchPageErrors(c)
  const downloads = mkdtempSync(join(tmpdir(), 'danfeed-backup-'))

  const interceptor = await stubApi(c, [
    { match: 'donmai.us/posts.json', json: POSTS },
    { match: 'cdn.donmai.us', image: PNG, contentLength: true },
  ])

  await c.send('Page.navigate', { url: APP })
  check('app rendered slides from the stubbed API', (await waitForSlides(c, 1)) > 0)
  await sleep(400)

  console.log('\n=== 1. save a post, then export it ===')
  await c.evalJS(`document.querySelector('[aria-label="Save"]').click()`)
  await sleep(300)
  check('the rail shows it saved', await c.evalJS(railSaved))

  // Real downloads need pointing at a directory; the newer browser-level command first.
  try {
    await c.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  } catch {
    await c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  }

  await openSettings(c)
  check('settings counts the saved post', (await c.evalJS(savedCount)) === '1 items', `got ${await c.evalJS(savedCount)}`)
  await c.evalJS(`document.querySelector('[aria-label="Back up to a file"]').click()`)
  const file = await waitForDownload(downloads)
  check('the download landed', file !== '', `nothing in ${downloads}`)
  check('the export said where it went', (await c.evalJS(bodyText)).includes('Backup saved to your downloads.'))

  const backup = file ? JSON.parse(readFileSync(file, 'utf8')) : {}
  check('the file names itself', backup.app === 'danfeed' && backup.format === 1, JSON.stringify(backup).slice(0, 200))
  check(
    'the saved post is in it',
    Array.isArray(backup.saved) && backup.saved.length === 1 && backup.saved[0].postId === POST_ID,
    JSON.stringify(backup.saved)?.slice(0, 200),
  )
  check('settings travel with it', backup.settings?.rating === 'general', JSON.stringify(backup.settings))

  console.log('\n=== 2. clear the list, then restore from that file ===')
  await c.evalJS(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Clear saved')).click()`)
  await sleep(300)
  check('the list is empty', (await c.evalJS(savedCount)) === '0 items', `got ${await c.evalJS(savedCount)}`)
  await closeSheet(c)
  check('the rail forgot the post', !(await c.evalJS(railSaved)))

  await openSettings(c)
  await pickFile(c, file)
  check(
    'the restore reported what it merged',
    (await c.evalJS(bodyText)).includes('1 saved post restored'),
    (await c.evalJS(bodyText)).slice(-200),
  )
  check('the post is back', (await c.evalJS(savedCount)) === '1 items', `got ${await c.evalJS(savedCount)}`)
  await closeSheet(c)
  check('the rail shows it saved again', await c.evalJS(railSaved))

  console.log('\n=== 3. restoring the same file again adds nothing ===')
  await openSettings(c)
  await pickFile(c, file)
  check('the duplicate was reported', (await c.evalJS(bodyText)).includes('already here'), (await c.evalJS(bodyText)).slice(-200))
  check('still one post', (await c.evalJS(savedCount)) === '1 items', `got ${await c.evalJS(savedCount)}`)

  console.log('\n=== 4. files that are not backups are refused ===')
  const garbage = join(downloads, 'garbage.json')
  writeFileSync(garbage, '{"hello":"world"}')
  await pickFile(c, garbage)
  check(
    'a foreign file is rejected by name',
    (await c.evalJS(bodyText)).includes('not a danfeed backup'),
    (await c.evalJS(bodyText)).slice(-200),
  )
  check('and changed nothing', (await c.evalJS(savedCount)) === '1 items', `got ${await c.evalJS(savedCount)}`)

  const otherApp = join(downloads, 'other-app.json')
  writeFileSync(otherApp, JSON.stringify({ app: 'someone-else', format: 1, saved: [] }))
  await pickFile(c, otherApp)
  check(
    'another app\'s export is refused too',
    (await c.evalJS(bodyText)).includes('not a danfeed backup'),
    (await c.evalJS(bodyText)).slice(-200),
  )

  console.log('\n=== 5. a backup cannot change the content rating ===')
  const sneaky = join(downloads, 'unfiltered.json')
  writeFileSync(
    sneaky,
    JSON.stringify({
      app: 'danfeed',
      format: 1,
      exportedAt: new Date().toISOString(),
      saved: [],
      recent: [],
      settings: { rating: 'all', maxVideoMb: 0, unmute: true },
    }),
  )
  check('the browser is still on the safe default', (await c.evalJS(gearLabel)) === 'Settings', `got ${await c.evalJS(gearLabel)}`)
  await pickFile(c, sneaky)
  check(
    'the file says its settings were ignored',
    (await c.evalJS(bodyText)).includes('Settings in the file were left alone.'),
    (await c.evalJS(bodyText)).slice(-200),
  )
  await closeSheet(c)
  check(
    'and the rating really did not move',
    (await c.evalJS(gearLabel)) === 'Settings',
    `got ${await c.evalJS(gearLabel)}`,
  )

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))

  c.off(interceptor)
  report()
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e.message)
  process.exit(2)
})
