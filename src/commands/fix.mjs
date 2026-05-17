import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import { writeFile, mkdir, stat } from 'node:fs/promises'
import { resolve, join, dirname, extname, sep } from 'node:path'
import { callMcp, callRest } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color, box } from '../util/output.mjs'
import { withPaywall } from '../util/paywall.mjs'

export const helpText = `
crawlfix fix <issueId> [options]

  Get an AI-generated, framework-aware fix prompt for an issue. Paid feature.

  Options:
    --copy            Copy the prompt to your system clipboard.
    --save [path]     Write a labeled .md file. Bare flag drops it in the
                      current directory with an auto-generated name. Pass a
                      directory to drop the auto-named file inside, or a
                      file path to write exactly there.
    --out <path>      Alias for --save <path>. Takes priority if both given.
    --json            Print raw JSON.
    --server <url>    Backend server URL.

  Environment:
    CRAWLFIX_OUT_DIR  Default save directory when --save is bare.

  Examples:
    crawlfix fix iss_xyz --save
    crawlfix fix iss_xyz --save ./fixes/
    crawlfix fix iss_xyz --out ./fixes/seo-title.md
`.trim()

export async function run(argv) {
  const issueId = argv._[1]
  if (!issueId) {
    process.stderr.write('Error: fix requires an issue id.\nRun `crawlfix help fix` for usage.\n')
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
  const result = await withPaywall(ctx, () =>
    callMcp({ server, token, tool: 'get_fix_prompts', args: { issue_id: issueId } }),
  )

  if (argv.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  const prompt = extractPrompt(result)
  if (!prompt) {
    process.stdout.write('No fix prompt returned by the server.\n')
    return
  }
  process.stdout.write('\n' + box(prompt, { title: `Fix prompt: ${issueId}` }) + '\n')

  if (argv.copy) {
    const ok = await copyToClipboard(prompt)
    if (ok) {
      process.stdout.write(`\n${color.green('Copied to clipboard.')}\n`)
    } else {
      process.stdout.write(`\n${color.yellow('Copy your platform clipboard tool is unavailable; paste manually.')}\n`)
    }
  }

  const saveFlag = argv.out !== undefined ? argv.out : argv.save
  if (saveFlag !== undefined && saveFlag !== false) {
    const meta = await fetchIssueMeta({ server, token, issueId, result })
    const savePath = await resolveSavePath(saveFlag, issueId, meta)
    const md = buildMarkdown({ issueId, prompt, meta, server })
    await mkdir(dirname(savePath), { recursive: true })
    await writeFile(savePath, md, 'utf8')
    process.stdout.write(`\n${color.green('Saved:')} ${savePath}\n`)
  }
}

function extractPrompt(result) {
  if (!result) return null
  if (typeof result === 'string') return result
  if (result.prompt) return String(result.prompt)
  if (result.fix_prompt) return String(result.fix_prompt)
  if (Array.isArray(result.prompts) && result.prompts.length) {
    return result.prompts.map(p => p.prompt || p.text || p).join('\n\n')
  }
  if (Array.isArray(result.fix_prompts) && result.fix_prompts.length) {
    return result.fix_prompts.map(p => p.prompt || p.text || p).join('\n\n')
  }
  // Fall back to a pretty-printed JSON dump.
  try { return JSON.stringify(result, null, 2) } catch { return String(result) }
}

async function copyToClipboard(text) {
  const p = platform()
  const cmd = p === 'win32' ? 'clip' : p === 'darwin' ? 'pbcopy' : 'xclip'
  const args = p === 'linux' ? ['-selection', 'clipboard'] : []
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    } catch {
      return resolve(false)
    }
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
    try {
      child.stdin.write(text)
      child.stdin.end()
    } catch {
      resolve(false)
    }
  })
}

// Pull whatever issue metadata we can — first from the MCP `get_fix_prompts`
// response (which sometimes includes the issue inline), then by walking the
// parent scan's issue list if we can recover a scan id. Returns an object with
// optional severity / category / url / title / message / scan_id fields.
async function fetchIssueMeta({ server, token, issueId, result }) {
  const inline = extractInlineMeta(result)
  const scanId = inline.scan_id
  if (inline.severity && inline.category && inline.title) return inline
  if (!scanId) return inline
  try {
    const list = await callRest({ server, token, method: 'GET', path: `/api/v1/scans/${scanId}/issues` })
    const issues = Array.isArray(list?.issues) ? list.issues : []
    const match = issues.find(i => i && (i.id === issueId || i.issue_id === issueId))
    if (match) {
      return {
        severity: inline.severity || match.severity,
        category: inline.category || match.category,
        url: inline.url || match.url || match.page_url,
        title: inline.title || match.title,
        message: inline.message || match.message,
        scan_id: scanId,
      }
    }
  } catch {
    // Best-effort enrichment; fall back to whatever we already had.
  }
  return inline
}

function extractInlineMeta(result) {
  if (!result || typeof result !== 'object') return {}
  const issue = (result.issue && typeof result.issue === 'object') ? result.issue : {}
  return {
    severity: result.severity || issue.severity,
    category: result.category || issue.category,
    url: result.url || result.page_url || issue.url || issue.page_url,
    title: result.title || issue.title,
    message: result.message || issue.message,
    scan_id: result.scan_id || result.audit_id || issue.scan_id || issue.audit_id,
  }
}

async function resolveSavePath(flag, issueId, meta) {
  const baseName = makeFilename(issueId, meta)

  // Bare --save / --out (boolean true): respect CRAWLFIX_OUT_DIR or cwd.
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
    // Path doesn't exist yet. Treat as directory if it has a trailing
    // separator or no file extension; otherwise as a file path.
    isDir = raw.endsWith('/') || raw.endsWith(sep) || extname(raw) === ''
  }
  return isDir ? join(abs, baseName) : abs
}

function makeFilename(issueId, meta) {
  const safeId = sanitizeForFilename(issueId)
  const host = hostFromMeta(meta)
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const parts = ['crawlfix-fix']
  if (safeId) parts.push(safeId)
  if (host) parts.push(host)
  parts.push(date)
  return parts.join('-') + '.md'
}

// Strip characters Windows / macOS / Linux disallow in filenames and collapse
// runs of dashes. The replacement set covers <>:"|?*\/ plus control chars.
function sanitizeForFilename(s) {
  return String(s ?? '')
    .replace(/[<>:"|?*\\/\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

function hostFromMeta(meta) {
  if (!meta || !meta.url) return null
  try { return sanitizeForFilename(new URL(meta.url).hostname) } catch { return null }
}

function buildMarkdown({ issueId, prompt, meta, server }) {
  const m = meta || {}
  const now = new Date().toISOString()
  const fm = ['---', `issue_id: ${yaml(issueId)}`]
  if (m.severity) fm.push(`severity: ${yaml(m.severity)}`)
  if (m.category) fm.push(`category: ${yaml(m.category)}`)
  if (m.url) fm.push(`url: ${yaml(m.url)}`)
  if (m.scan_id) fm.push(`scan_id: ${yaml(m.scan_id)}`)
  fm.push(`generated_at: ${now}`)
  fm.push(`source: crawlfix-cli`)
  fm.push('---')

  const heading = m.title ? `Crawlfix fix: ${m.title}` : `Crawlfix fix: ${issueId}`
  const body = [
    '',
    `# ${heading}`,
    '',
  ]
  if (m.message) {
    body.push(`> ${m.message.replace(/\r?\n/g, ' ')}`)
    body.push('')
  }
  body.push('## Fix prompt')
  body.push('')
  body.push(prompt.trimEnd())
  body.push('')
  body.push('---')
  body.push(`Generated by [Crawlfix](${server || 'https://crawlfix.ai'}) on ${now.slice(0, 10)}.`)
  body.push('')
  return fm.concat(body).join('\n')
}

// Quote a YAML scalar only when it contains characters that would otherwise
// need escaping. Keeps simple values like ids and slugs unquoted.
function yaml(v) {
  const s = String(v ?? '')
  if (/^[A-Za-z0-9._\-:/]+$/.test(s)) return s
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
