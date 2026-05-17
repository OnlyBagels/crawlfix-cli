import { callMcp } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color, scoreColor, scoreBandLabel } from '../util/output.mjs'
import { withPaywall } from '../util/paywall.mjs'

export const helpText = `
crawlfix compare <auditId> <competitorUrl> [options]

  Run a side-by-side audit of your site (by audit id) against a competitor URL.
  Paid feature.

  Options:
    --json            Print raw JSON.
    --server <url>    Backend server URL.
`.trim()

export async function run(argv) {
  const auditId = argv._[1]
  const competitor = argv._[2]
  if (!auditId || !competitor) {
    process.stderr.write('Error: compare requires <auditId> <competitorUrl>.\n')
    const e = new Error('missing args'); e.exitCode = 2; throw e
  }
  const creds = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }
  const ctx = { server, token }
  // compare_competitor runs a fresh scan of the competitor URL on the server
  // side, which can take 60-180s for a real site. Give the request a 5-min
  // budget instead of the 60s default that other tools use.
  const result = await withPaywall(ctx, () =>
    callMcp({
      server, token,
      tool: 'compare_competitor',
      args: { audit_id: auditId, competitor_url: ensureScheme(competitor) },
      timeoutMs: 300_000,
    }),
  )
  if (argv.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  printSideBySide(result)
}

function printSideBySide(result) {
  if (!result) {
    process.stdout.write('No comparison data returned.\n')
    return
  }
  const you = result.you || result.self || result.audit || {}
  const them = result.competitor || result.them || {}
  const yourScore = you.score
  const theirScore = them.score
  process.stdout.write('\n')
  process.stdout.write(color.bold('Side-by-side:') + '\n')
  process.stdout.write(`  You:        ${formatScore(yourScore)} (${you.domain || you.url || ''})\n`)
  process.stdout.write(`  Competitor: ${formatScore(theirScore)} (${them.domain || them.url || ''})\n`)
  const recs = Array.isArray(result.recommendations) ? result.recommendations : []
  if (recs.length) {
    process.stdout.write('\n' + color.bold('Top recommendations:') + '\n')
    recs.slice(0, 10).forEach((r, i) => {
      const title = r.title || r.message || (typeof r === 'string' ? r : JSON.stringify(r))
      process.stdout.write(`  ${i + 1}. ${title}\n`)
    })
  }
}
function formatScore(s) {
  if (!Number.isFinite(Number(s))) return color.gray('n/a')
  return `${scoreColor(s)(`${s} / 100`)} [${scoreBandLabel(s)}]`
}
function ensureScheme(u) { return /^https?:\/\//i.test(u) ? u : `https://${u}` }
