import { color } from '../util/output.mjs'

const SUMMARY = [
  ['login',   'Authenticate this machine with Crawlfix.'],
  ['logout',  'Clear locally stored credentials.'],
  ['whoami',  'Show the currently logged-in account.'],
  ['scan',    'Run an audit against a URL.'],
  ['issues',  'List issues for an audit.'],
  ['fix',     'Get a fix prompt for an issue. (paid)'],
  ['history', 'List your recent audits.'],
  ['verify',  'Re-crawl to confirm a fix worked.'],
  ['export',  'Download an audit report as JSON, HTML, or PDF. (paid)'],
  ['compare', 'Side-by-side audit against a competitor. (paid)'],
  ['monitor', 'Schedule recurring scans and alerts. (paid)'],
  ['help',    'Show this help, or detailed help for one command.'],
]

export const helpText = `
crawlfix help [command]

  Show the global command list, or detailed help for one command.
`.trim()

export async function run(argv, { commands } = {}) {
  const which = argv._[1]
  if (which && commands && commands[which]?.helpText) {
    process.stdout.write(commands[which].helpText + '\n')
    return
  }
  process.stdout.write(`${color.bold('crawlfix')}, the external SEO and AI-search auditor.\n\n`)
  process.stdout.write('Usage:\n  crawlfix <command> [options]\n\n')
  process.stdout.write('Commands:\n')
  const w = Math.max(...SUMMARY.map(([n]) => n.length))
  for (const [name, desc] of SUMMARY) {
    process.stdout.write(`  ${color.cyan(name.padEnd(w))}   ${desc}\n`)
  }
  process.stdout.write('\nEnvironment:\n')
  process.stdout.write('  CRAWLFIX_SERVER   Override the backend URL (default https://crawlfix.ai).\n')
  process.stdout.write('  CRAWLFIX_TOKEN    Bearer token (for CI / scripting). Takes priority over saved creds.\n')
  process.stdout.write('  CRAWLFIX_DEBUG    Set to 1 to print stack traces on errors.\n')
  process.stdout.write('  NO_COLOR          Disable ANSI colors.\n')
  process.stdout.write('  FORCE_COLOR       Force ANSI colors on (1 or true).\n')
  process.stdout.write('\nRun `crawlfix help <command>` for details on a specific command.\n')
  process.stdout.write('Docs: https://crawlfix.ai\n')
}
