import { callRest } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color, spinner, scoreBandLabel, scoreColor, categoryColor } from '../util/output.mjs'
import { sleep } from '../util/poll.mjs'

export const helpText = `
crawlfix scan <url> [options]

  Run a full SEO + AI-search audit against a URL.

  Options:
    --server <url>    Backend server URL.
    --json            Print raw JSON, no formatting.
    --no-wait         Submit the scan and return immediately.
    --timeout <sec>   Max seconds to wait for completion (default 180).

  Examples:
    crawlfix scan example.com
    crawlfix scan https://example.com --json
`.trim()

export async function run(argv) {
  const target = argv._[1]
  if (!target) {
    process.stderr.write('Error: scan requires a URL.\nRun `crawlfix help scan` for usage.\n')
    const e = new Error('missing url'); e.exitCode = 2; throw e
  }
  const creds = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first, or set CRAWLFIX_TOKEN.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }
  const url = ensureHasScheme(target)
  const created = await callRest({
    server, token, method: 'POST', path: '/api/v1/scans', body: { url },
  })
  const scanId = created.scan_id || created.id
  if (!scanId) throw new Error('Server did not return a scan id.')

  if (argv.json && (argv.wait === false || argv.noWait)) {
    process.stdout.write(JSON.stringify(created, null, 2) + '\n')
    return
  }

  const wait = argv.wait !== false && !argv.noWait
  if (!wait) {
    if (argv.json) {
      process.stdout.write(JSON.stringify(created, null, 2) + '\n')
    } else {
      process.stdout.write(`Scan queued: ${color.bold(scanId)}\n`)
      process.stdout.write(`Check status:  crawlfix issues ${scanId}\n`)
    }
    return
  }

  const timeoutMs = (Number(argv.timeout) || 180) * 1000
  const sp = argv.json ? null : spinner(`Crawling ${prettyDomain(url)}... (queued)`)
  if (sp) sp.start()
  const tickInt = sp ? setInterval(() => sp.tick(), 200) : null
  const start = Date.now()
  let final = null
  try {
    while (Date.now() - start < timeoutMs) {
      await sleep(3000)
      let snapshot
      try {
        snapshot = await callRest({ server, token, method: 'GET', path: `/api/v1/scans/${scanId}` })
      } catch (err) {
        if (sp) sp.update(`Crawling ${prettyDomain(url)}... ${color.gray('(retrying)')}`)
        continue
      }
      const status = snapshot.status || 'pending'
      const progress = snapshot.progress != null ? ` ${snapshot.progress}%` : ''
      if (sp) sp.update(`Crawling ${prettyDomain(url)}... (status: ${status}${progress})`)
      if (status === 'completed' || status === 'failed' || status === 'error') {
        final = snapshot
        break
      }
    }
  } finally {
    if (tickInt) clearInterval(tickInt)
  }

  if (!final) {
    if (sp) sp.fail(`Timed out waiting for scan ${scanId}. It may still finish; check 'crawlfix issues ${scanId}'.`)
    const e = new Error('scan timed out'); e.exitCode = 1; throw e
  }
  if (final.status !== 'completed') {
    if (sp) sp.fail(`Scan ${scanId} ended with status: ${final.status}`)
    const e = new Error(`scan status ${final.status}`); e.exitCode = 1; throw e
  }
  if (sp) sp.success(`Audit ${color.bold(scanId)} complete.`)

  if (argv.json) {
    process.stdout.write(JSON.stringify(final, null, 2) + '\n')
    return
  }

  printSummary(scanId, final)
}

function printSummary(scanId, snapshot) {
  const result = snapshot.result || snapshot
  const score = result.score
  const issues = Array.isArray(result.issues) ? result.issues : []
  const buckets = bucket(issues, 'severity')
  const totals = {
    critical: (buckets.critical || []).length,
    high: (buckets.high || []).length,
    medium: ((buckets.medium || []).length + (buckets.med || []).length),
    low: (buckets.low || []).length,
    info: (buckets.info || []).length,
  }
  const cats = bucket(issues, 'category')

  process.stdout.write('\n')
  if (Number.isFinite(Number(score))) {
    const c = scoreColor(score)
    process.stdout.write(`Score: ${c(`${score} / 100`)}   [${scoreBandLabel(score)}]\n`)
  }
  process.stdout.write(
    `Issues: ${totals.critical} critical, ${totals.high} high, ${totals.medium} medium, ${totals.low} low (${issues.length} total)\n\n`,
  )
  const catNames = Object.keys(cats)
  if (catNames.length) {
    process.stdout.write(color.bold('Top categories:') + '\n')
    catNames
      .map(c => ({ name: c, items: cats[c] }))
      .sort((a, b) => b.items.length - a.items.length)
      .slice(0, 5)
      .forEach(c => {
        const colorFn = categoryColor(c.name)
        const avg = avgScore(c.items)
        const scoreStr = avg != null ? `score ${pad2(avg)}` : ''
        process.stdout.write(`  ${colorFn(padRight(c.name, 18))}  ${scoreStr}  ${c.items.length} issues\n`)
      })
    process.stdout.write('\n')
  }
  process.stdout.write(`View full report:    ${color.cyan(`crawlfix issues ${scanId}`)}\n`)
  process.stdout.write(`Get fix prompts:     ${color.cyan(`crawlfix fix <issueId>`)}\n`)
  process.stdout.write(`Export PDF:          ${color.cyan(`crawlfix export ${scanId} --format pdf`)}  ${color.gray('(paid)')}\n`)

  // Free-tier teaser, if the server marks it.
  const gated = result.tier === 'free' || snapshot.tier === 'free' || result.gated === true || snapshot.gated === true
  const shownCount = result.shown_count || result.shown || (gated ? Math.max(1, Math.round(issues.length * 0.2)) : null)
  if (gated) {
    process.stdout.write('\n')
    process.stdout.write(color.yellow(
      `Free tier shows the lowest-severity 20% (${shownCount || '?'} of ${issues.length} issues).`,
    ) + '\n')
    process.stdout.write(`Upgrade to see all:  ${color.cyan('crawlfix login')}  then any paid command will prompt to pay.\n`)
  }
}

function bucket(items, key) {
  const out = {}
  for (const it of items) {
    const k = (it && it[key] ? String(it[key]) : 'unknown').toLowerCase()
    if (!out[k]) out[k] = []
    out[k].push(it)
  }
  return out
}

function avgScore(items) {
  const scores = items.map(i => Number(i.score)).filter(Number.isFinite)
  if (!scores.length) return null
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

function pad2(n) { return String(n).padStart(2, ' ') }
function padRight(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length) }

function ensureHasScheme(s) {
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s}`
}
function prettyDomain(u) {
  try { return new URL(u).hostname } catch { return u }
}
