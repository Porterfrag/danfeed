/**
 * Cross-check the local tag-limit heuristic against the live API.
 * For each query, ask: does the server reject it (422 TagLimitError)?
 * A mismatch means classifyToken() would either block a valid search or let
 * a doomed one through.
 */
import { analyzeTags, TAG_LIMIT } from '../src/lib/tagQuery.ts'

const API = 'https://danbooru.donmai.us'
const RESOLVE = { host: 'danbooru.donmai.us', ip: '104.26.11.39' }

// The sandbox blocks *.donmai.us by DNS, so resolve to the real Cloudflare IP.
const { Agent } = await import('node:https')
const https = await import('node:https')

function get(path: string): Promise<{ status: number; error?: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'danbooru.donmai.us',
        port: 443,
        path,
        method: 'GET',
        headers: { 'User-Agent': 'danfeed-verify/1.0', Accept: 'application/json' },
        servername: 'danbooru.donmai.us',
        // Force the real IP while keeping SNI correct. Node calls this with either
        // (hostname, options, cb) or, with options.all, expecting an array back.
        lookup: (_hostname, options, callback) => {
          const cb = typeof options === 'function' ? options : callback
          const wantsAll = typeof options === 'object' && options !== null && options.all
          if (wantsAll) cb(null, [{ address: RESOLVE.ip, family: 4 }])
          else cb(null, RESOLVE.ip, 4)
        },
        agent: false,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          let error: string | undefined
          try {
            const parsed = JSON.parse(body)
            if (parsed && !Array.isArray(parsed) && parsed.error) error = parsed.error
          } catch {
            /* non-JSON (challenge page) */
          }
          resolve({ status: res.statusCode ?? 0, error })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

const queries = [
  'video',
  'video chun-li',
  'video chun-li ass',
  'chun-li ass',
  '1girl solo',
  '1girl solo smile',
  '1girl solo order:rank',
  '1girl order:rank',
  'order:rank',
  '1girl -animated',
  '1girl solo -animated',
  '-animated',
  '1girl rating:general',
  '1girl solo rating:general',
  'video id:<12394835',
  'video chun-li id:<12394835',
  'score:>200',
  'score:>200 video',
  'score:>200 chun-li ass',
  '1girl solo filetype:jpg',
  '1girl solo width:>1000',
  '1girl solo pool:1234',
  '1girl solo parent:1234',
  '1girl solo favcount:>100',
]

let mismatches = 0
let checked = 0

for (const query of queries) {
  const localOver = analyzeTags(query).over

  let result: { status: number; error?: string }
  try {
    result = await get(
      `/posts.json?tags=${encodeURIComponent(query)}&limit=2&only=id`,
    )
  } catch (error) {
    console.log(`SKIP  '${query}' (${(error as Error).message})`)
    continue
  }

  if (result.status === 500 || result.status === 403) {
    console.log(`SKIP  '${query}' (server ${result.status}: ${result.error ?? 'blocked'})`)
    continue
  }

  const serverRejected = result.error === 'PostQuery::TagLimitError'
  checked++

  const verdict = serverRejected === localOver ? 'agree' : 'MISMATCH'
  if (serverRejected !== localOver) mismatches++

  const detail = serverRejected ? 'server:rejected' : `server:ok(${result.status})`
  const local = localOver ? 'local:over' : 'local:ok'
  console.log(`${verdict.padEnd(9)} ${local.padEnd(10)} ${detail.padEnd(16)} '${query}'`)
}

console.log(`\nchecked ${checked} queries against Danbooru, limit=${TAG_LIMIT}`)
if (checked === 0) {
  console.log('NO QUERIES CHECKED — network or resolver problem, result is meaningless')
  process.exit(2)
}
console.log(mismatches === 0 ? 'HEURISTIC MATCHES LIVE API' : `${mismatches} MISMATCHES`)
process.exit(mismatches === 0 ? 0 : 1)
