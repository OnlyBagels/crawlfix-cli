import { callMcp } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color } from '../util/output.mjs'
import { withPaywall } from '../util/paywall.mjs'

export const helpText = `
crawlfix verify <issueId> [options]

  Re-crawl the affected page (or a preview URL) to confirm a fix worked.

  Options:
    --page <url>      Verify against a specific URL (e.g. a preview deploy).
    --json            Print raw JSON.
    --server <url>    Backend server URL.
`.trim()

export async function run(argv) {
  const issueId = argv._[1]
  if (!issueId) {
    process.stderr.write('Error: verify requires an issue id.\n')
    const e = new Error('missing issue id'); e.exitCode = 2; throw e
  }
  const creds = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }

  const ctx = { server, token }
  const args = { issue_id: issueId }
  if (typeof argv.page === 'string') args.page_url = argv.page

  const result = await withPaywall(ctx, () =>
    callMcp({ server, token, tool: 'verify_fix', args }),
  )

  if (argv.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  const fixed = result && (result.fixed === true || result.status === 'fixed' || result.resolved === true)
  if (fixed) {
    process.stdout.write(color.green(`Issue ${issueId} appears fixed.`) + '\n')
  } else {
    process.stdout.write(color.yellow(`Issue ${issueId} is still present.`) + '\n')
    if (result?.reason) process.stdout.write(`  ${result.reason}\n`)
  }
  if (result?.scan_id) {
    process.stdout.write(`\nVerification scan: ${color.gray(result.scan_id)}\n`)
  }
}
