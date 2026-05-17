import { promises as fs } from 'node:fs'
import { resolve as resolvePath, basename } from 'node:path'
import { callMcp, callRest } from '../api.mjs'
import { loadCredentials, resolveServer, resolveToken } from '../config.mjs'
import { color } from '../util/output.mjs'
import { withPaywall } from '../util/paywall.mjs'

export const helpText = `
crawlfix export <auditId> --format json|html|pdf [options]

  Download a paid audit report.

  Options:
    --format <fmt>    json, html, or pdf (required).
    --output <path>   Output file path. Defaults to <auditId>.<ext> in CWD.
    --server <url>    Backend server URL.
`.trim()

export async function run(argv) {
  const auditId = argv._[1]
  if (!auditId) {
    process.stderr.write('Error: export requires an audit id.\n')
    const e = new Error('missing audit id'); e.exitCode = 2; throw e
  }
  const format = String(argv.format || '').toLowerCase()
  if (!['json', 'html', 'pdf'].includes(format)) {
    process.stderr.write('Error: --format must be one of json, html, pdf.\n')
    const e = new Error('bad format'); e.exitCode = 2; throw e
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
    callMcp({ server, token, tool: 'export_report', args: { audit_id: auditId, format } }),
  )

  const url = result?.url || result?.signed_url || result?.download_url
  if (!url) {
    if (result) {
      // Server might have inlined the content (e.g. JSON). Save it directly.
      const outPath = argv.output ? resolvePath(String(argv.output)) : resolvePath(process.cwd(), `${auditId}.${format}`)
      const data = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      await fs.writeFile(outPath, data, 'utf8')
      process.stdout.write(`Wrote ${color.cyan(outPath)} (${data.length} bytes)\n`)
      return
    }
    throw new Error('Server did not return a download URL.')
  }

  // Stream-download the signed URL.
  const ext = format
  const defaultName = safeBasename(url) || `${auditId}.${ext}`
  const outPath = argv.output ? resolvePath(String(argv.output)) : resolvePath(process.cwd(), defaultName)
  const isAbsolute = /^https?:\/\//i.test(url)
  let bin
  if (isAbsolute) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    bin = Buffer.from(await res.arrayBuffer())
  } else {
    const r = await callRest({
      server, token, method: 'GET', path: url, accept: contentTypeFor(ext),
    })
    bin = r?.body ? r.body : Buffer.from(typeof r === 'string' ? r : JSON.stringify(r))
  }
  await fs.writeFile(outPath, bin)
  process.stdout.write(`Wrote ${color.cyan(outPath)} (${bin.length} bytes)\n`)
}

function safeBasename(u) {
  try { return basename(new URL(u).pathname) } catch { return null }
}
function contentTypeFor(ext) {
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'html') return 'text/html'
  return 'application/json'
}
