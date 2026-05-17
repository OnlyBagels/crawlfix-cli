// `crawlfix policy <subcommand>` — generate, list, and install Crawlfix
// policy documents (privacy, cookie, terms, AUP).
//
// Subcommands:
//   generate   POST /api/policies/generate (paid; goes through the paywall flow)
//   list       GET  /api/policies          (lists policies for the account)
//   install    GET  /api/v1/install-prompts/policy?framework=... (open)
//
// Output / persistence flags follow the same conventions as `crawlfix fix`:
//   --json          raw JSON to stdout
//   --copy          copy primary output to system clipboard
//   --save [path]   write a labeled .md (bare flag = cwd; pass a dir or file)
//   --out <path>    alias for --save <path>; takes priority if both given

import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { writeFile, mkdir, stat } from 'node:fs/promises'
import { resolve, join, dirname, extname, sep } from 'node:path'
import { callRest } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color, box, table } from '../util/output.mjs'
import { withPaywall } from '../util/paywall.mjs'

export const helpText = `
crawlfix policy <subcommand> [args]

  Generate, list, and install Crawlfix policy documents
  (privacy, cookie, terms, AUP).

  Subcommands:
    generate    Generate a policy document for a domain. (paid)
    list        List policies for your account.
    install     Print an "install this policy" prompt for your coding agent.

  Examples:
    crawlfix policy generate --domain example.com --type privacy --business-name "Acme"
    crawlfix policy list --domain example.com
    crawlfix policy install --type privacy --framework next-app --save

  Run \`crawlfix help policy <subcommand>\` for per-subcommand options.
`.trim()

const VALID_TYPES = new Set(['privacy', 'cookie', 'terms', 'aup'])
const VALID_FRAMEWORKS = new Set(['next-app', 'nuxt', 'sveltekit', 'astro', 'plain-html'])

export async function run(argv) {
  const sub = argv._[1]
  if (!sub) {
    process.stderr.write('Error: policy requires a subcommand (generate | list | install).\n')
    process.stderr.write('Run `crawlfix help policy` for usage.\n')
    const e = new Error('missing subcommand'); e.exitCode = 2; throw e
  }
  if (sub === 'generate') return runGenerate(argv)
  if (sub === 'list')     return runList(argv)
  if (sub === 'install')  return runInstall(argv)
  process.stderr.write(`Unknown policy subcommand: ${sub}\n`)
  const e = new Error('unknown sub'); e.exitCode = 2; throw e
}

// ---------------------------------------------------------------------------
// policy generate
// ---------------------------------------------------------------------------

async function runGenerate(argv) {
  const domain = argv.domain
  const type   = argv.type
  if (!domain) {
    process.stderr.write('Error: --domain is required.\n')
    const e = new Error('missing --domain'); e.exitCode = 2; throw e
  }
  if (!type || !VALID_TYPES.has(type)) {
    process.stderr.write(`Error: --type must be one of ${[...VALID_TYPES].join(', ')}.\n`)
    const e = new Error('bad --type'); e.exitCode = 2; throw e
  }

  const creds  = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token  = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }

  const body = {
    domain,
    type,
    businessInfo: {
      name:          argv.businessName  || domain,
      country:       argv.country       || undefined,
      contactEmail:  argv.contactEmail  || undefined,
    },
  }
  if (argv.jurisdictions) {
    body.jurisdictions = splitCsv(argv.jurisdictions)
  }
  if (argv.audienceRegions) {
    body.audienceRegions = splitCsv(argv.audienceRegions)
  }

  const ctx = { server, token }
  const result = await withPaywall(ctx, () =>
    callRest({ server, token, method: 'POST', path: '/api/policies/generate', body }),
  )

  if (argv.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  const md = result?.markdown
  if (!md) {
    process.stdout.write('Server did not return markdown. Raw response:\n')
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }
  process.stdout.write(md.trimEnd() + '\n')

  const saveFlag = argv.out !== undefined ? argv.out : argv.save
  if (saveFlag !== undefined && saveFlag !== false) {
    const savePath = await resolveSavePath(saveFlag, defaultPolicyFilename(domain, type))
    await mkdir(dirname(savePath), { recursive: true })
    await writeFile(savePath, md, 'utf8')
    process.stdout.write(`\n${color.green('Saved:')} ${savePath}\n`)
  } else if (result.id || result.slug) {
    const idPart = result.id ? `id=${result.id}` : ''
    const slugPart = result.slug ? `slug=${result.slug}` : ''
    process.stdout.write(`\n${color.gray(`Stored: ${[idPart, slugPart].filter(Boolean).join(' ')}`)}\n`)
  }
}

// ---------------------------------------------------------------------------
// policy list
// ---------------------------------------------------------------------------

async function runList(argv) {
  const creds  = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token  = resolveToken(creds)
  if (!token) {
    process.stderr.write('Not logged in. Run `crawlfix login` first.\n')
    const e = new Error('no token'); e.exitCode = 1; throw e
  }
  const res = await callRest({ server, token, method: 'GET', path: '/api/policies' })
  let policies = Array.isArray(res?.policies) ? res.policies : Array.isArray(res) ? res : []
  if (argv.domain) {
    const want = String(argv.domain).toLowerCase()
    policies = policies.filter(p => String(p.domain || '').toLowerCase() === want)
  }
  if (argv.json) {
    process.stdout.write(JSON.stringify(policies, null, 2) + '\n')
    return
  }
  if (!policies.length) {
    process.stdout.write('No policies yet. Run `crawlfix policy generate` to create one.\n')
    return
  }
  const rows = policies.map(p => ({
    id:       p.id || '',
    domain:   p.domain || '',
    type:     p.type || '',
    version:  p.version != null ? String(p.version) : '',
    created:  formatDate(p.created_at),
    published: p.published_at ? 'yes' : 'no',
  }))
  process.stdout.write(table(rows, [
    { key: 'id',        label: 'ID' },
    { key: 'domain',    label: 'DOMAIN' },
    { key: 'type',      label: 'TYPE' },
    { key: 'version',   label: 'VER' },
    { key: 'created',   label: 'CREATED' },
    { key: 'published', label: 'PUBLISHED' },
  ]) + '\n')
}

// ---------------------------------------------------------------------------
// policy install
// ---------------------------------------------------------------------------

async function runInstall(argv) {
  const type      = argv.type || 'privacy'
  const framework = argv.framework
  if (type && !VALID_TYPES.has(type)) {
    process.stderr.write(`Error: --type must be one of ${[...VALID_TYPES].join(', ')}.\n`)
    const e = new Error('bad --type'); e.exitCode = 2; throw e
  }
  if (framework && !VALID_FRAMEWORKS.has(framework)) {
    process.stderr.write(`Warning: --framework "${framework}" is not in the known list (${[...VALID_FRAMEWORKS].join(', ')}). Passing it anyway.\n`)
  }
  const creds  = await loadCredentials()
  const server = resolveServer(argv.server, creds)
  const token  = resolveToken(creds)

  const query = { type }
  if (framework) query.framework = framework
  if (argv.domain) query.domain = argv.domain
  if (argv.siteId) query.site_id = argv.siteId

  const res = await callRest({
    server, token,
    method: 'GET',
    path: '/api/v1/install-prompts/policy',
    query,
  })

  const prompt = extractPrompt(res)
  if (argv.json) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n')
    return
  }
  if (!prompt) {
    process.stdout.write('No install prompt returned by the server.\n')
    return
  }
  process.stdout.write('\n' + box(prompt, { title: `Policy install prompt (${type})` }) + '\n')

  if (argv.copy) {
    const ok = await copyToClipboard(prompt)
    process.stdout.write(
      ok ? `\n${color.green('Copied to clipboard.')}\n`
         : `\n${color.yellow('Clipboard tool unavailable; paste manually.')}\n`,
    )
  }
  const saveFlag = argv.out !== undefined ? argv.out : argv.save
  if (saveFlag !== undefined && saveFlag !== false) {
    const savePath = await resolveSavePath(saveFlag, `crawlfix-install-policy-${type}${framework ? `-${framework}` : ''}.md`)
    await mkdir(dirname(savePath), { recursive: true })
    await writeFile(savePath, prompt + '\n', 'utf8')
    process.stdout.write(`\n${color.green('Saved:')} ${savePath}\n`)
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (kept local to mirror the structure of fix.mjs).
// ---------------------------------------------------------------------------

function splitCsv(v) {
  return String(v).split(',').map(s => s.trim()).filter(Boolean)
}

function defaultPolicyFilename(domain, type) {
  const safeDomain = sanitizeForFilename(domain)
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `crawlfix-policy-${type}-${safeDomain}-${date}.md`
}

function sanitizeForFilename(s) {
  return String(s ?? '')
    .replace(/[<>:"|?*\\/\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
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

function extractPrompt(result) {
  if (!result) return null
  if (typeof result === 'string') return result
  if (typeof result.prompt === 'string') return result.prompt
  if (typeof result.install_prompt === 'string') return result.install_prompt
  if (typeof result.markdown === 'string') return result.markdown
  if (typeof result.text === 'string') return result.text
  // Best-effort fallback for combined "all" responses.
  if (Array.isArray(result.prompts)) {
    return result.prompts.map(p => p.prompt || p.text || p).join('\n\n---\n\n')
  }
  return null
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

function formatDate(d) {
  if (!d) return ''
  try {
    const dt = d instanceof Date ? d : new Date(d)
    if (Number.isNaN(dt.getTime())) return String(d)
    return dt.toISOString().slice(0, 10)
  } catch { return String(d) }
}
