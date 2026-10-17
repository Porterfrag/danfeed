#!/usr/bin/env node
/**
 * End-to-end run: build, serve `dist`, and drive it in headless Chrome.
 *
 * Each suite gets its own browser with a throwaway profile, because several of them assert
 * things about a *fresh* browser (the safe rating on the first request, settings persistence
 * across a reload). Sharing one browser between suites would leak localStorage between them.
 *
 *   npm run test:e2e                 every suite
 *   npm run test:e2e -- tags rating  only these
 *   npm run test:e2e -- --no-build   reuse the existing dist
 *
 * Chrome must be installed; CHROME_PATH overrides the search. The suites assume a phone-width
 * viewport, which this sets (see launchChrome).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildFingerprint,
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
const SUITES = [
  'tags',
  'entities',
  'rating',
  'search-panel',
  'history',
  'backup',
  'share',
  'keyboard',
  'tag-actions',
  'retry',
  'pwa',
  'a11y',
  'discover',
]
const SUITE_TIMEOUT_MS = Number(process.env.SUITE_TIMEOUT_MS || 240_000)

const argv = process.argv.slice(2)
const noBuild = argv.includes('--no-build')
const wanted = argv.filter((a) => !a.startsWith('--'))
const selected = wanted.length > 0 ? wanted : SUITES
for (const name of selected) {
  if (!SUITES.includes(name)) {
    console.error(`unknown suite "${name}" — known: ${SUITES.join(', ')}`)
    process.exit(2)
  }
}

let preview = null
let browser = null
let profile = null
let previewUrl = ''

/** Stop this suite's browser and throw its profile away; the preview stays up. */
async function stopBrowser() {
  if (!browser) return
  await stopChrome(browser, profile)
  browser = null
  profile = null
}

async function cleanup() {
  await stopBrowser()
  if (preview && preview.exitCode === null) preview.kill()
}
process.on('SIGINT', async () => {
  await cleanup()
  process.exit(130)
})

/** Run one suite in its own browser. Returns { name, ok, passed, failed, seconds, output }. */
async function runSuite(name) {
  const cdpPort = await freePort()
  profile = tempProfile()
  browser = launchChrome({ port: cdpPort, profile })

  if (!(await waitForCdp(cdpPort))) {
    await stopBrowser()
    return { name, ok: false, passed: 0, failed: 0, seconds: 0, output: 'Chrome never opened its debug port' }
  }

  const started = Date.now()
  const output = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'tests', `${name}.mjs`)], {
      env: { ...process.env, CDP_PORT: String(cdpPort), APP_URL: previewUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let text = ''
    const collect = (chunk) => {
      text += chunk
      process.stdout.write(chunk)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    const timer = setTimeout(() => {
      text += `\n[runner] ${name} exceeded ${SUITE_TIMEOUT_MS} ms and was killed\n`
      child.kill()
    }, SUITE_TIMEOUT_MS)

    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ text, code })
    })
  })

  await stopBrowser()

  const tally = /(\d+) passed, (\d+) failed/.exec(output.text)
  return {
    name,
    ok: output.code === 0,
    passed: Number(tally?.[1] ?? 0),
    failed: Number(tally?.[2] ?? (output.code === 0 ? 0 : 1)),
    seconds: (Date.now() - started) / 1000,
    output: output.text,
  }
}

async function main() {
  if (!noBuild) {
    console.log('\n--- build ---')
    runBuild(ROOT)
  }

  const dist = join(ROOT, 'dist')
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('dist/index.html is missing. Run `npm run build` first (or drop --no-build).')
    process.exit(2)
  }

  const chrome = findChrome()
  console.log(`\n--- build under test (chrome: ${chrome}) ---`)
  for (const f of buildFingerprint(dist)) console.log(`  ${f.sha}  ${f.kb.padStart(7)} KB  ${f.file}`)

  const appPort = await freePort()
  previewUrl = `http://localhost:${appPort}/`
  preview = startPreview({ root: ROOT, port: appPort })
  if (!(await waitForHttp(previewUrl))) {
    await cleanup()
    console.error(`preview never answered on ${previewUrl}`)
    process.exit(2)
  }

  const results = []
  for (const name of selected) {
    console.log(`\n${'='.repeat(60)}\n${name}\n${'='.repeat(60)}`)
    results.push(await runSuite(name))
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}\nsummary\n${'='.repeat(60)}`)
  for (const r of results) {
    const mark = r.ok ? 'ok  ' : 'FAIL'
    console.log(
      `  ${mark}  ${r.name.padEnd(14)} ${String(r.passed).padStart(3)} passed` +
        `${r.failed ? `, ${r.failed} failed` : ''}   ${r.seconds.toFixed(1)}s`,
    )
  }
  const passed = results.reduce((n, r) => n + r.passed, 0)
  const failed = results.reduce((n, r) => n + r.failed, 0)
  console.log(`\n${passed} assertions passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(`\nrunner error: ${e.message}`)
  await cleanup()
  process.exit(2)
})
