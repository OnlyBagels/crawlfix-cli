// `crawlfix analytics <subcommand>` — embeddable, consent-aware analytics
// widget.
//
// Subcommands:
//   snippet   GET /api/v1/snippets/analytics?site_id=...   (paid)
//   install   GET /api/v1/install-prompts/analytics?...    (open)
//
// `snippet` requires --site-id so the marketplace JS knows where to report.

import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { writeFile, mkdir, stat } from 'node:fs/promises'
import { resolve, join, dirname, extname, sep } from 'node:path'
import { callRest } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color, box } from '../util/output.mjs'
import { withPaywall } from '../util/paywall.mjs'

export const helpText = `
crawlfix analytics <subcommand> [args]

  Embeddable, consent-aware analytics widget.

  Subcommands:
    snippet   Print the <script> tag for your site. Requires --site-id. (paid)
    install   Print a framework-specific install prompt for your agent.

  Common options:
    --site-id <id>      Your Crawlfix site id.
    --framework <name>  next-app | nuxt | sveltekit | astro | plain-html.
    --copy              (install) Copy the prompt to your system clipboard.
    --save [path]       (install) Write a .md (bare = cwd, dir, or path).
    --out <path>        (install) Alias for --save.
    --json              Print raw JSON.

  Examples:
    crawlfix analytics snippet --site-id site_abc
    crawlfix analytics install --site-id site_abc --framework next-app --copy
`.trim()

const VALID_FRAMEWORKS = new Set(['next-app', 'nuxt', 'sveltekit', 'astro', 'plain-html'])

export async function run(argv) {
  const sub = argv._[1]
  if (!sub) {
    process.stderr.write('Error: analytics requires a subcommand (snippet | install).\n')
    process.stderr.write('Run `crawlfix help analytics` for usage.\n')
    const e = new Error('missing subcommand'); e.exitCode = 2; throw e
  }
  if (sub === 'snippet') return runSnippet(argv)
  if (sub === 'install') return runInstall(argv)
  process.stderr.write(`Unknown analytics subcommand: ${sub}\n`)
  const e = new Error('unknown sub'); e.exitCode = 2; throw e
}

async function runSnippet(argv) {
  const siteId = argv.siteId
  if (!siteId) {
    process.stderr.write('Error: --site-id is required.\n')
    const e = new Error('missing --site-id'); e.exitCode = 2; throw e
  }
  const creds  = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token  = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }
  const ctx = { server, token }
  const res = await withPaywall(ctx, () =>
    callRest({
      server, token,
      method: 'GET',
      path: '/api/v1/snippets/analytics',
      query: { site_id: siteId },
    }),
  )
  if (argv.json) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n')
    return
  }
  const snippet = extractSnippet(res)
  const scriptUrl = res?.script_url || res?.url || null
  if (snippet) {
    process.stdout.write('\n' + box(snippet, { title: 'Analytics snippet' }) + '\n')
  } else {
    process.stdout.write('Server did not return a snippet. Raw response:\n')
    process.stdout.write(JSON.stringify(res, null, 2) + '\n')
  }
  if (scriptUrl) {
    process.stdout.write(`\n${color.gray('Marketplace JS:')} ${color.cyan(scriptUrl)}\n`)
  }
}

async function runInstall(argv) {
  const siteId    = argv.siteId
  const framework = argv.framework
  if (!siteId) {
    process.stderr.write('Error: --site-id is required.\n')
    const e = new Error('missing --site-id'); e.exitCode = 2; throw e
  }
  if (framework && !VALID_FRAMEWORKS.has(framework)) {
    process.stderr.write(`Warning: --framework "${framework}" not in known list (${[...VALID_FRAMEWORKS].join(', ')}). Passing anyway.\n`)
  }

  const creds  = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token  = resolveToken(creds)

  const query = { site_id: siteId }
  if (framework)   query.framework = framework
  if (argv.domain) query.domain    = argv.domain

  const res = await callRest({
    server, token,
    method: 'GET',
    path: '/api/v1/install-prompts/analytics',
    query,
  })

  if (argv.json) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n')
    return
  }
  const prompt = extractPrompt(res)
  if (!prompt) {
    process.stdout.write('No install prompt returned by the server.\n')
    return
  }
  process.stdout.write('\n' + box(prompt, { title: `Analytics install prompt${framework ? ` (${framework})` : ''}` }) + '\n')

  if (argv.copy) {
    const ok = await copyToClipboard(prompt)
    process.stdout.write(
      ok ? `\n${color.green('Copied to clipboard.')}\n`
         : `\n${color.yellow('Clipboard tool unavailable; paste manually.')}\n`,
    )
  }
  const saveFlag = argv.out !== undefined ? argv.out : argv.save
  if (saveFlag !== undefined && saveFlag !== false) {
    const savePath = await resolveSavePath(saveFlag, `crawlfix-install-analytics${framework ? `-${framework}` : ''}.md`)
    await mkdir(dirname(savePath), { recursive: true })
    await writeFile(savePath, prompt + '\n', 'utf8')
    process.stdout.write(`\n${color.green('Saved:')} ${savePath}\n`)
  }
}

// ---------------------------------------------------------------------------

function extractSnippet(result) {
  if (!result) return null
  if (typeof result === 'string') return result
  if (typeof result.snippet === 'string') return result.snippet
  if (typeof result.tag === 'string') return result.tag
  if (typeof result.script_tag === 'string') return result.script_tag
  if (typeof result.html === 'string') return result.html
  if (typeof result.markup === 'string') return result.markup
  return null
}

function extractPrompt(result) {
  if (!result) return null
  if (typeof result === 'string') return result
  if (typeof result.prompt === 'string') return result.prompt
  if (typeof result.install_prompt === 'string') return result.install_prompt
  if (typeof result.markdown === 'string') return result.markdown
  if (typeof result.text === 'string') return result.text
  if (Array.isArray(result.prompts)) {
    return result.prompts.map(p => p.prompt || p.text || p).join('\n\n---\n\n')
  }
  return null
}

async function resolveSavePath(flag, baseName) {
  if (flag === true) {
    const envDir = process.env.CRAWLFIX_OUT_DIR
    const dir = envDir && envDir.trim() ? envDir.trim() : process.cwd()
    return join(resolve(dir), baseName)
  }
  const raw = String(flag)
  const abs = resolve(process.cwd(), raw)
  let isDir = false
  try {
    const st = await stat(abs)
    isDir = st.isDirectory()
  } catch {
    isDir = raw.endsWith('/') || raw.endsWith(sep) || extname(raw) === ''
  }
  return isDir ? join(abs, baseName) : abs
}

async function copyToClipboard(text) {
  const p = platform()
  const cmd = p === 'win32' ? 'clip' : p === 'darwin' ? 'pbcopy' : 'xclip'
  const args = p === 'linux' ? ['-selection', 'clipboard'] : []
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    } catch { return resolve(false) }
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
    try {
      child.stdin.write(text)
      child.stdin.end()
    } catch { resolve(false) }
  })
}
