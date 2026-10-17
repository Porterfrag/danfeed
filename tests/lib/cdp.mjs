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
 * and `status` to answer with a failure instead of 200.
 */
export async function stubApi(cdp, routes, { requestStage = false } = {}) {
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*donmai.us*', ...(requestStage ? { requestStage: 'Request' } : {}) }],
  })

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

    const isJson = route.json !== undefined
    const body = isJson ? Buffer.from(JSON.stringify(route.json)).toString('base64') : route.image
    const headers = [
      { name: 'content-type', value: route.type ?? (isJson ? 'application/json' : 'image/png') },
      { name: 'access-control-allow-origin', value: '*' },
    ]
    if (route.contentLength) {
      headers.push({ name: 'content-length', value: String(Buffer.from(body, 'base64').length) })
    }

    try {
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: route.status ?? 200,
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
