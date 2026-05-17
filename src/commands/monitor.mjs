import { callMcp } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color, table } from '../util/output.mjs'
import { withPaywall } from '../util/paywall.mjs'

export const helpText = `
crawlfix monitor <subcommand> [args]

  Manage scheduled domain monitoring. Paid feature.

  Subcommands:
    add <domain>      Add a domain to monitoring.
    remove <domain>   Stop monitoring a domain.
    list              List monitored domains.
    pause <domain>    Pause alerts on a domain.
    resume <domain>   Resume alerts on a domain.

  Options:
    --json            Print raw JSON.
    --server <url>    Backend server URL.
`.trim()

const PAID_SUBS = new Set(['add', 'resume'])

export async function run(argv) {
  const sub = argv._[1]
  if (!sub) {
    process.stderr.write('Error: monitor requires a subcommand.\nRun `crawlfix help monitor` for usage.\n')
    const e = new Error('missing subcommand'); e.exitCode = 2; throw e
  }
  const creds = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }
  const ctx = { server, token }

  const domain = argv._[2]
  const needsDomain = sub !== 'list'
  if (needsDomain && !domain) {
    process.stderr.write(`Error: monitor ${sub} requires a domain.\n`)
    const e = new Error('missing domain'); e.exitCode = 2; throw e
  }

  const toolMap = {
    add: 'monitor_add',
    remove: 'monitor_remove',
    list: 'monitor_list',
    pause: 'monitor_pause',
    resume: 'monitor_resume',
  }
  const tool = toolMap[sub]
  if (!tool) {
    process.stderr.write(`Unknown monitor subcommand: ${sub}\n`)
    const e = new Error('unknown sub'); e.exitCode = 2; throw e
  }
  const args = needsDomain ? { domain } : {}

  const call = () => callMcp({ server, token, tool, args })
  const result = PAID_SUBS.has(sub) ? await withPaywall(ctx, call) : await call()

  if (argv.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  if (sub === 'list') {
    const items = Array.isArray(result?.monitors) ? result.monitors : Array.isArray(result) ? result : []
    if (!items.length) {
      process.stdout.write('No monitored domains.\n')
      return
    }
    const rows = items.map(m => ({
      domain: m.domain || m.url || '',
      status: m.status || (m.paused ? 'paused' : 'active'),
      lastScan: m.last_scan_at || m.last_scan || '',
      nextScan: m.next_scan_at || m.next_scan || '',
    }))
    process.stdout.write(table(rows, [
      { key: 'domain', label: 'DOMAIN' },
      { key: 'status', label: 'STATUS' },
      { key: 'lastScan', label: 'LAST SCAN' },
      { key: 'nextScan', label: 'NEXT SCAN' },
    ]) + '\n')
    return
  }
  const verb = { add: 'added', remove: 'removed', pause: 'paused', resume: 'resumed' }[sub] || sub
  process.stdout.write(color.green(`Monitor ${verb}: ${domain}`) + '\n')
}
