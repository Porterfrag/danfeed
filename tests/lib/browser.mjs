/**
 * Process plumbing for the suites: finding a browser, getting a port, serving `dist`, and
 * fingerprinting the build under test.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sleep } from './cdp.mjs'

const CHROME_PATHS = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Edge is Chromium and speaks the same protocol, so it works as a fallback.
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
}

export function findChrome() {
  const fromEnv = process.env.CHROME_PATH
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`CHROME_PATH points at nothing: ${fromEnv}`)
    return fromEnv
  }
  for (const path of CHROME_PATHS[process.platform] ?? []) {
    if (path && existsSync(path)) return path
  }
  throw new Error(
    'No Chrome, Chromium or Edge found. Install one, or set CHROME_PATH to the binary.\n' +
      'The suites need a real browser: they drive the production build through the CDP protocol.',
  )
}

/** An unused localhost port, handed to Chrome/vite by the OS rather than guessed. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

export function launchChrome({ port, profile, windowSize = '420x900', executable = findChrome() }) {
  return spawn(
    executable,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-component-update',
      '--mute-audio',
      // The suites assume a phone-width viewport: one of them probes the middle of the feed
      // with elementFromPoint, and the header hides its wordmark below 640px.
      `--window-size=${windowSize}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
}

export async function waitForCdp(port, { tries = 60 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) return true
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  return false
}

/** Stop the browser and throw its profile away. */
export async function stopChrome(child, profile) {
  if (child && child.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill()
    })
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  if (profile) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    } catch {
      /* a locked profile in the OS temp dir is not worth failing a run over */
    }
  }
}

export function tempProfile() {
  return mkdtempSync(join(tmpdir(), 'danfeed-e2e-'))
}

/** `vite preview`, serving whatever is currently in dist/. */
export function startPreview({ root, port }) {
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(vite)) {
    throw new Error(`vite is missing at ${vite}. Run: npm install`)
  }
  const child = spawn(
    process.execPath,
    [vite, 'preview', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] },
  )
  child.stderr.on('data', (b) => process.stderr.write(`[preview] ${b}`))
  return child
}

export async function waitForHttp(url, { tries = 80 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  return false
}

/**
 * A short content hash per built file, so the build the browser was driven against can be
 * compared with the one Cloudflare Pages deployed. Sizes and names alone do not prove that.
 */
export function buildFingerprint(distDir) {
  const files = []
  for (const sub of ['', 'assets']) {
    const dir = sub ? join(distDir, sub) : distDir
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (!statSync(path).isFile()) continue
      files.push(sub ? `${sub}/${name}` : name)
    }
  }
  return files.sort().map((rel) => {
    const buf = readFileSync(join(distDir, rel))
    return {
      file: rel,
      kb: (buf.length / 1024).toFixed(1),
      sha: createHash('sha256').update(buf).digest('hex').slice(0, 8),
    }
  })
}

/** `npm run build` in the repo root, inherited stdio. */
export function runBuild(root) {
  // Run npm through node when we know where it lives (npm sets npm_execpath for us): spawning
  // npm.cmd directly needs a shell, which Node deprecation-warns about.
  const npmCli = process.env.npm_execpath
  const res =
    npmCli && existsSync(npmCli)
      ? spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: root, stdio: 'inherit' })
      : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
          cwd: root,
          stdio: 'inherit',
          shell: process.platform === 'win32',
        })
  if (res.status !== 0) throw new Error('npm run build failed')
}
