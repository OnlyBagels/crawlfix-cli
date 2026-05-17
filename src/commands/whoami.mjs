import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color } from '../util/output.mjs'

export const helpText = `
crawlfix whoami

  Print the currently authenticated account, or exit 1 if not logged in.
`.trim()

export async function run(argv) {
  const creds = await loadCredentials()
  const token = resolveToken(creds)
  const server = resolveServer(argv.server, creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first.\n')
    const e = new Error('not logged in'); e.exitCode = 1; throw e
  }
  const email = creds?.email || (process.env.CRAWLFIX_TOKEN ? '(CRAWLFIX_TOKEN env var)' : 'unknown')
  const accountId = creds?.accountId ? ` (${creds.accountId})` : ''
  process.stdout.write(`Logged in as ${color.bold(email)}${accountId}\n`)
  process.stdout.write(`${color.gray('Server:')} ${server}\n`)
}
