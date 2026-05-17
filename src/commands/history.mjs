import { callRest, callMcp } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color, table, severityColor } from '../util/output.mjs'

export const helpText = `
crawlfix history [options]

  List your recent audits.

  Options:
    --limit <n>       Max rows to show (default 20).
    --json            Print raw JSON.
    --server <url>    Backend server URL.
`.trim()

export async function run(argv) {
  const creds = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }
  const limit = Math.max(1, Math.min(100, parseInt(argv.limit, 10) || 20))

  let scans
  try {
    const list = await callRest({ server, token, method: 'GET', path: '/api/v1/scans' })
    scans = Array.isArray(list) ? list : []
  } catch {
    // Fall back to the MCP tool when the REST list endpoint isn't reachable.
    const res = await callMcp({ server, token, tool: 'get_audit_history', args: { limit } })
    scans = Array.isArray(res?.audits) ? res.audits : Array.isArray(res) ? res : []
  }

  const rows = scans.slice(0, limit).map(s => {
    const id = s.scan_id || s.id || s.audit_id || ''
    const url = s.url || s.domain || ''
    const completed = s.completed_at || s.completedAt || s.created_at || ''
    return {
      id,
      domain: prettyDomain(url),
      date: formatDate(completed),
      score: s.score != null ? String(s.score) : '',
      issues: s.issue_count != null ? String(s.issue_count) : (Array.isArray(s.issues) ? String(s.issues.length) : ''),
    }
  })

  if (argv.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n')
    return
  }

  if (!rows.length) {
    process.stdout.write('No audits yet. Run `crawlfix scan <url>` to start one.\n')
    return
  }
  // Color the score column by severity-ish bucket.
  for (const r of rows) {
    if (r.score) {
      const n = Number(r.score)
      const sev = n < 40 ? 'high' : n < 60 ? 'medium' : n < 80 ? 'low' : 'info'
      r.score = severityColor(sev)(r.score)
    }
  }
  process.stdout.write(table(rows, [
    { key: 'id', label: 'ID' },
    { key: 'domain', label: 'DOMAIN' },
    { key: 'date', label: 'DATE' },
    { key: 'score', label: 'SCORE' },
    { key: 'issues', label: 'ISSUES' },
  ]) + '\n')
  process.stdout.write(`\n${color.gray(`Showing ${rows.length} audit(s).`)}\n`)
}

function prettyDomain(u) {
  if (!u) return ''
  try { return new URL(u.startsWith('http') ? u : `https://${u}`).hostname } catch { return u }
}
function formatDate(d) {
  if (!d) return ''
  try {
    const dt = d instanceof Date ? d : new Date(d)
    if (Number.isNaN(dt.getTime())) return String(d)
    const yyyy = dt.getFullYear()
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    const dd = String(dt.getDate()).padStart(2, '0')
    const hh = String(dt.getHours()).padStart(2, '0')
    const mi = String(dt.getMinutes()).padStart(2, '0')
    const ss = String(dt.getSeconds()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
  } catch { return String(d) }
}
