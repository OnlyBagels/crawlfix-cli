import { callRest } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color, severityColor, categoryColor, table } from '../util/output.mjs'

export const helpText = `
crawlfix issues <auditId> [options]

  List the issues for a completed audit.

  Options:
    --severity <s>    Filter by severity: critical, high, medium, low, info.
    --category <c>    Filter by category (e.g. SEO, Security, Performance).
    --json            Print raw JSON.
    --server <url>    Backend server URL.
`.trim()

export async function run(argv) {
  const auditId = argv._[1]
  if (!auditId) {
    process.stderr.write('Error: issues requires an audit id.\nRun `crawlfix help issues` for usage.\n')
    const e = new Error('missing audit id'); e.exitCode = 2; throw e
  }
  const creds = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first, or set CRAWLFIX_TOKEN.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }

  let payload
  try {
    payload = await callRest({ server, token, method: 'GET', path: `/api/v1/scans/${auditId}/issues` })
  } catch (err) {
    // Fall back: the full scan record also embeds issues under .result.issues.
    const snap = await callRest({ server, token, method: 'GET', path: `/api/v1/scans/${auditId}` })
    payload = { scan_id: auditId, issues: snap?.result?.issues || [] }
  }
  let issues = Array.isArray(payload.issues) ? payload.issues : []

  if (argv.severity) {
    const want = String(argv.severity).toLowerCase()
    issues = issues.filter(i => String(i.severity || '').toLowerCase() === want)
  }
  if (argv.category) {
    const want = String(argv.category).toLowerCase()
    issues = issues.filter(i => String(i.category || '').toLowerCase() === want)
  }

  if (argv.json) {
    process.stdout.write(JSON.stringify({ scan_id: payload.scan_id || auditId, issues }, null, 2) + '\n')
    return
  }

  if (!issues.length) {
    process.stdout.write('No issues match the given filters.\n')
    return
  }

  const rows = issues.map(i => ({
    id: i.id || '',
    severity: severityColor(i.severity)(String(i.severity || 'info').toUpperCase()),
    category: categoryColor(i.category)(String(i.category || '')),
    title: truncate(String(i.title || i.message || ''), 80),
  }))
  process.stdout.write(table(rows, [
    { key: 'id', label: 'ID' },
    { key: 'severity', label: 'SEVERITY' },
    { key: 'category', label: 'CATEGORY' },
    { key: 'title', label: 'TITLE' },
  ]) + '\n')
  process.stdout.write(`\n${color.gray(`${issues.length} issue(s)`)}\n`)
  process.stdout.write(`Get a fix prompt:  ${color.cyan('crawlfix fix <id>')}\n`)
}

function truncate(s, n) {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
