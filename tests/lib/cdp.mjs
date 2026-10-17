/**
 * The CDP plumbing every suite shares.
 *
 * A minimal client, the pass/fail reporter, the Danbooru request stubber, and the waits that
 * used to be copy-pasted into each suite. Node has a global WebSocket, so this needs no
 * dependencies — `npm run test:e2e` works on a fresh clone after `npm ci`.
 *
 * The suites never touch the real Danbooru: it is DNS-blocked on some networks, and headless
 * Chrome is fingerprinted by Cloudflare anyway, so every request is answered from a fixture.
 */

import { writeFileSync } from 'node:fs'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A 1x1 transparent PNG, so stubbed media "loads" without shipping a file. */
export const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = []
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = () => rej(new Error(`ws connect failed: ${url}`))
    })
    const c = new CDP(ws)
    ws.onmessage = (ev) => c.#msg(JSON.parse(ev.data))
    return c
  }

  #msg(m) {
    if (m.id && this.pending.has(m.id)) {
      const { resolve, reject } = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (m.error) reject(new Error(m.error.message))
      else resolve(m.result)
    } else {
      for (const h of this.handlers) h(m)
    }
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(fn) {
    this.handlers.push(fn)
    return fn
  }

  off(fn) {
    this.handlers = this.handlers.filter((h) => h !== fn)
  }

  async evalJS(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'eval threw')
    }
    return r.result.value
  }

  /** Save a PNG of the viewport. Used by tests/screenshots.mjs, not by the assertions. */
  async shot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(data, 'base64'))
    console.log(`wrote ${path}`)
    return path
  }
}

/**
 * Attach to the page the runner opened. Chrome may take a moment to expose it, so this
 * retries rather than assuming the debug port is ready.
 */
export async function connectToPage(port, { tries = 60 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (target) {
        const c = await CDP.connect(target.webSocketDebuggerUrl)
        await c.send('Page.enable')
        await c.send('Runtime.enable')
        return c
      }
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error(
    `no CDP page target on 127.0.0.1:${port} — start Chrome with --remote-debugging-port`,
  )
}

/**
 * Answer the app's Danbooru requests from fixtures.
 *
 * `routes` are tried in order, first match wins; anything unmatched is passed through to the
 * network, which the app is expected to survive. Each route is one of:
 *
 *   { match: '/posts.json',  json: POSTS, record: postCalls }  // URL substring, served as JSON
 *   { match: 'cdn.donmai.us', image: PNG, contentLength: true } // served as an image
 *
 * A route may set `type` to override the content type (the screenshot harness serves SVG),
 * `status` to answer with a failure instead of 200, `fail` to answer with that failure for the
 * first N requests before behaving normally, `failNetwork` to drop the connection for the
 * first N — how a transient 5xx is staged for the retry tests — and `delay` to hold the answer
 * back that many milliseconds, which is how a slow image is staged for the blur-up.
 */
export async function stubApi(cdp, routes, { requestStage = false } = {}) {
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*donmai.us*', ...(requestStage ? { requestStage: 'Request' } : {}) }],
  })

  /** How many failures each route has handed out so far, for routes with a `fail` count. */
  const served = new Map()

  return cdp.on(async (m) => {
    if (m.method !== 'Fetch.requestPaused') return
    const { requestId, request } = m.params
    const route = routes.find((r) => request.url.includes(r.match))

    if (!route) {
      try {
        await cdp.send('Fetch.continueRequest', { requestId })
      } catch {
        /* target navigated */
      }
      return
    }

    if (route.record) route.record.push(request.url)

    const alreadyFailed = served.get(route) ?? 0
    if (route.failNetwork && alreadyFailed < route.failNetwork) {
      // A dropped connection rather than a bad answer: what a phone sees going through a tunnel.
      served.set(route, alreadyFailed + 1)
      try {
        await cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionFailed' })
      } catch {
        /* target navigated */
      }
      return
    }

    if (route.fail !== undefined && alreadyFailed < route.fail) {
      served.set(route, alreadyFailed + 1)
      try {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: route.status ?? 503,
          responseHeaders: [
            { name: 'content-type', value: 'application/json' },
            { name: 'access-control-allow-origin', value: '*' },
          ],
          body: Buffer.from(
            JSON.stringify({ error: 'Server error', message: 'Danbooru is having a moment.' }),
          ).toString('base64'),
        })
      } catch {
        /* target navigated */
      }
      return
    }

    const isJson = route.json !== undefined
    const body = isJson ? Buffer.from(JSON.stringify(route.json)).toString('base64') : route.image
    const headers = [
      { name: 'content-type', value: route.type ?? (isJson ? 'application/json' : 'image/png') },
      { name: 'access-control-allow-origin', value: '*' },
    ]
    if (route.contentLength) {
      headers.push({ name: 'content-length', value: String(Buffer.from(body, 'base64').length) })
    }

    if (route.delay) await sleep(route.delay)

    try {
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        // A `status` on its own means "always answer this way" — the error-card suites rely on it.
        // With a `fail` count it describes only the first N answers, and the rest are the real
        // thing, or a transient failure could never clear up.
        responseCode: route.fail === undefined && route.status !== undefined ? route.status : 200,
        responseHeaders: headers,
        body,
      })
    } catch {
      /* target navigated */
    }
  })
}

/** Collect uncaught page errors, so a suite can assert the app threw nothing. */
export function watchPageErrors(cdp) {
  const errors = []
  cdp.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description ?? 'unknown error')
    }
  })
  return errors
}

/** Wait until the feed has rendered at least `count` slides. Returns how many it saw. */
export async function waitForSlides(cdp, count = 1, { tries = 80 } = {}) {
  let seen = 0
  for (let i = 0; i < tries; i++) {
    seen = await cdp.evalJS(`document.querySelectorAll('[data-slide]').length`)
    if (seen >= count) return seen
    await sleep(250)
  }
  return seen
}

/** Set the search box the way a user does, so React's onChange sees it. */
export const setSearchText = (text) => `(() => {
  const input = document.querySelector('[role="combobox"]')
  if (!input) return 'no-input'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(text)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`

export const pressEnter = `(() => {
  document.querySelector('[role="combobox"]').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
  )
  return 'ok'
})()`

/**
 * Press a key at the document.
 *
 * The app's shortcuts listen on `window`, and the event is dispatched rather than typed through
 * `Input.dispatchKeyEvent` so the browser keeps its own handling of the key: real keys like `/`
 * (quick-find) and Ctrl+S (save page) are the browser's, and a suite that pressed them for real
 * would be testing Chrome rather than the app.
 *
 * The event's target is the document, which is exactly the "nothing is focused" case the app
 * guards for. A suite that wants the input-focused case dispatches on the input instead.
 */
export const pressKey = (key, init = {}) =>
  `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ...${JSON.stringify(init)} }))`

/**
 * Stand-in media behaviour for headless Chrome.
 *
 * The fixtures are a 1×1 PNG. Chrome cannot decode that as a video and has no decoder for
 * anything a test could reasonably embed, so elements are given a truthful `paused` and a
 * `play`/`pause` pair that report through the same events the app listens for. Their decode
 * failure is kept away from the app, which would otherwise — correctly — put up its error card
 * a moment later. `__playCalls` and `__pauseCalls` count the calls, which is what the
 * reduced-motion test asserts on: the app's job is to call `play()`, not to decode.
 *
 * Installed with `Page.addScriptToEvaluateOnNewDocument`, so it runs before any app code. The
 * capture listener on `window` runs before React's own, wherever React attached it.
 */
export const MEDIA_SHIM = `(() => {
  window.__playCalls = 0
  window.__pauseCalls = 0
  HTMLMediaElement.prototype.play = function () {
    window.__playCalls++
    this.__paused = false
    this.dispatchEvent(new Event('play', { bubbles: true }))
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function () {
    window.__pauseCalls++
    this.__paused = true
    this.dispatchEvent(new Event('pause', { bubbles: true }))
  }
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get() { return this.__paused ?? true },
  })
  window.addEventListener('error', (event) => {
    if (event.target instanceof HTMLMediaElement) event.stopImmediatePropagation()
  }, true)
})()`

/** Install MEDIA_SHIM for this page and every document it loads after. */
export function installMediaShim(cdp) {
  return cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: MEDIA_SHIM })
}

/**
 * Click an element through the browser's own input pipeline.
 *
 * A programmatic `click()` never focuses the button, so it cannot be used to test anything about
 * focus; this can. Needs `Emulation.setFocusEmulationEnabled`, since headless Chrome never gives
 * the page system focus on its own.
 */
export async function mouseClick(cdp, selector) {
  const at = await cdp.evalJS(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  })()`)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: at.x,
    y: at.y,
    button: 'left',
    clickCount: 1,
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: at.x,
    y: at.y,
    button: 'left',
    clickCount: 1,
  })
}

const failures = []
let pass = 0
let fail = 0

export function check(label, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`)
  }
}

/** Print the suite's tally and exit: non-zero if anything failed. */
export function report() {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) console.log(`failed: ${failures.join(' | ')}`)
  process.exit(fail === 0 ? 0 : 1)
}
