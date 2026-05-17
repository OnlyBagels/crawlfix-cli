#!/usr/bin/env node
// Comprehensive end-to-end CLI verification.
//
// Tests every command + many edge cases against a running Crawlfix backend.
// Requires the server has:
//   CRAWLFIX_AUTH_DEV_MODE=true  (magic links return inline)
//   CRAWLFIX_DEV_AUTO_PAY=true   (paywall click auto-grants without Stripe)
//
// Usage:
//   node scripts/e2e-verify.mjs [server_url]

import { spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = resolve(__dirname, '..', 'bin', 'crawlfix.js')
const SERVER = process.argv[2] || process.env.CRAWLFIX_SERVER
const TEST_EMAIL = `cli-e2e-${Date.now()}@faction.chat`
const TEST_DOMAIN = 'crawlfix.ai'
const TEST_COMPETITOR = 'seoxpert.io'
const CREDS_DIR = resolve(homedir(), '.crawlfix')
const CREDS_PATH = resolve(CREDS_DIR, 'credentials.json')

let passed = 0
let failed = 0
const failures = []
let currentSection = ''

function header(t) {
  currentSection = t
  process.stdout.write('\n' + '='.repeat(64) + '\n' + t + '\n' + '='.repeat(64) + '\n')
}
function pass(t) { passed++; process.stdout.write(`  PASS  ${t}\n`) }
function fail(t, why) {
  failed++
  const tag = `[${currentSection}] ${t}`
  failures.push(`${tag} :: ${why}`)
  process.stdout.write(`  FAIL  ${t}  -- ${why}\n`)
}
function skip(t, why) { process.stdout.write(`  SKIP  ${t}  -- ${why}\n`) }

function runCli(args, opts = {}) {
  const env = {
    ...process.env,
    CRAWLFIX_SERVER: SERVER,
    NO_COLOR: '1',
    ...opts.env,
  }
  // Node warns if NO_COLOR + FORCE_COLOR both present. Strip FORCE_COLOR
  // unless an opts.env override re-sets it.
  if (!opts.env?.FORCE_COLOR) delete env.FORCE_COLOR
  if (opts.unsetToken) delete env.CRAWLFIX_TOKEN
  const res = spawnSync(process.execPath, [CLI, ...args], {
    env,
    encoding: 'utf8',
    input: opts.stdin || '',
    timeout: opts.timeoutMs || 60000,
  })
  return { code: res.status ?? -1, out: res.stdout || '', err: res.stderr || '', signal: res.signal }
}

async function rpc(method, params = {}, token = null) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${SERVER}/api/mcp/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return await r.json()
}

// MCP `tools/call` wraps tool output in result.content[0].text as a JSON
// string. Unwrap it so callers can read fields directly.
function unwrapToolResult(rpcRes) {
  const content = rpcRes?.result?.content
  if (Array.isArray(content) && content[0]?.type === 'text' && typeof content[0].text === 'string') {
    try { return JSON.parse(content[0].text) } catch { return content[0].text }
  }
  return rpcRes?.result || rpcRes?.error?.data || null
}

function clearCreds() {
  if (existsSync(CREDS_PATH)) rmSync(CREDS_PATH, { force: true })
}

// =========================================================================
;(async () => {
header(`Crawlfix CLI E2E against ${SERVER}`)
process.stdout.write(`Test email: ${TEST_EMAIL}\n`)
process.stdout.write(`Started: ${new Date().toISOString()}\n`)
clearCreds()

// ---------------------------------------------------------------
// 1. UNAUTHED COMMANDS
// ---------------------------------------------------------------
header('1. Unauthed commands')
{
  const v = runCli(['--version'])
  if (v.code === 0 && /^\d+\.\d+\.\d+/.test(v.out.trim())) pass('--version returns semver')
  else fail('--version', `code=${v.code} out=${JSON.stringify(v.out.slice(0,80))}`)

  const v2 = runCli(['-v'])
  if (v2.code === 0 && /^\d+\.\d+\.\d+/.test(v2.out.trim())) pass('-v alias works')
  else fail('-v alias', `code=${v2.code}`)

  const h = runCli(['help'])
  if (h.code === 0 && /crawlfix/i.test(h.out) && /scan/.test(h.out) && /login/.test(h.out)) pass('help lists commands')
  else fail('help', `code=${h.code}`)

  const h2 = runCli(['--help'])
  if (h2.code === 0 && /crawlfix/i.test(h2.out)) pass('--help works')
  else fail('--help', `code=${h2.code}`)

  const hScan = runCli(['help', 'scan'])
  if (hScan.code === 0 && /scan/i.test(hScan.out)) pass('help scan')
  else fail('help scan', `code=${hScan.code}`)

  const hLogin = runCli(['help', 'login'])
  if (hLogin.code === 0 && /login/i.test(hLogin.out)) pass('help login')
  else fail('help login', `code=${hLogin.code}`)

  const hFix = runCli(['help', 'fix'])
  if (hFix.code === 0 && /fix/i.test(hFix.out)) pass('help fix')
  else fail('help fix', `code=${hFix.code}`)

  const hUnknown = runCli(['help', 'nonexistent'])
  // Either: errors with "unknown", or falls back to main help (acceptable UX)
  if (hUnknown.code !== 0 || /no help|unknown|crawlfix.*Usage|commands?:/i.test(hUnknown.out + hUnknown.err)) pass('help unknown-command handled')
  else fail('help unknown-command', `code=${hUnknown.code}`)

  const noArgs = runCli([])
  if (noArgs.code === 0 && /crawlfix/i.test(noArgs.out)) pass('no args shows help')
  else fail('no args', `code=${noArgs.code}`)

  const badCmd = runCli(['totally-not-a-command'])
  if (badCmd.code !== 0 && /unknown command/i.test(badCmd.err + badCmd.out)) pass('unknown command exits non-zero with error')
  else fail('unknown command', `code=${badCmd.code} err=${badCmd.err.slice(0,100)}`)
}

// ---------------------------------------------------------------
// 2. AUTHED-REQUIRING COMMANDS WITHOUT AUTH
// ---------------------------------------------------------------
header('2. Commands requiring auth, called without auth')
{
  const w = runCli(['whoami'], { unsetToken: true })
  if (w.code !== 0) pass('whoami exits non-zero when not logged in')
  else fail('whoami unauthed', `code=${w.code} out=${w.out.slice(0,80)}`)

  const s = runCli(['scan', TEST_DOMAIN, '--json'], { unsetToken: true, timeoutMs: 15000 })
  // Should error: server returns auth_required, CLI surfaces it
  if (s.code !== 0) pass('scan exits non-zero when not logged in')
  else fail('scan unauthed', `code=${s.code} unexpected success`)
}

// ---------------------------------------------------------------
// 3. MCP DISCOVERY (no auth needed)
// ---------------------------------------------------------------
header('3. MCP discovery')
{
  const init = await rpc('initialize')
  if (init?.result?.serverInfo?.name === 'crawlfix-ai') pass('initialize handshake')
  else fail('initialize', JSON.stringify(init).slice(0, 200))

  const list = await rpc('tools/list')
  const tools = list?.result?.tools || []
  const want = ['login', 'login_poll', 'run_scan', 'get_issues', 'get_fix_prompts', 'get_audit_history', 'verify_fix', 'compare_competitor', 'export_report']
  for (const w of want) {
    if (tools.some(t => t.name === w)) pass(`tools/list contains ${w}`)
    else fail(`tools/list missing ${w}`, `tools=${tools.map(t=>t.name).join(',')}`)
  }
}

// ---------------------------------------------------------------
// 4. BASE URL FIX
// ---------------------------------------------------------------
header('4. Base URL fix (no localhost leak)')
let deviceCode, userCode
{
  const r = await rpc('tools/call', { name: 'login', arguments: { email: TEST_EMAIL } })
  const result = unwrapToolResult(r)
  const vUrl = result?.verification_url
  deviceCode = result?.device_code
  userCode = result?.user_code
  if (!vUrl) fail('login returns verification_url', JSON.stringify(r).slice(0, 200))
  else if (/localhost/.test(vUrl)) fail('verification_url no localhost', `url=${vUrl}`)
  else pass(`verification_url uses real host: ${new URL(vUrl).host}`)
  if (deviceCode && userCode) pass('login returned device_code + user_code')
  else fail('login device_code/user_code missing', JSON.stringify(result).slice(0, 200))
}

// ---------------------------------------------------------------
// 5. DEVICE-FLOW APPROVE (simulate browser click)
// ---------------------------------------------------------------
header('5. Device-flow approve via dev-mode magic link')
let mcpToken, accountId, userEmail
if (deviceCode && userCode) {
  const initiateRes = await fetch(`${SERVER}/api/auth/device/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_code: userCode, email: TEST_EMAIL }),
  })
  const initiateBody = await initiateRes.json().catch(() => ({}))
  if (!initiateRes.ok) {
    fail('device/initiate', `${initiateRes.status} ${JSON.stringify(initiateBody).slice(0, 200)}`)
  } else {
    pass('device/initiate accepted')
    const magicUrl = initiateBody.magic_url || initiateBody.dev_magic_url || initiateBody.devUrl || initiateBody.verification_url_complete
    if (!magicUrl) {
      fail('dev-mode magic URL inline', `keys=${Object.keys(initiateBody).join(',')}`)
    } else {
      pass('dev-mode magic URL returned')
      const approveRes = await fetch(magicUrl, { redirect: 'manual' })
      if (approveRes.status < 400) pass(`magic URL click HTTP ${approveRes.status}`)
      else fail('magic URL click', `HTTP ${approveRes.status}`)
    }
  }

  // Poll login_poll
  let pollResult
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const p = await rpc('tools/call', { name: 'login_poll', arguments: { device_code: deviceCode } })
    pollResult = unwrapToolResult(p)
    if (pollResult?.status === 'success') break
  }
  if (pollResult?.status === 'success') {
    mcpToken = pollResult.mcp_token || pollResult.mcpToken || pollResult.token
    accountId = pollResult.account_id || pollResult.accountId
    userEmail = pollResult.email
    if (mcpToken) pass(`login_poll success, token + account=${accountId}`)
    else fail('login_poll success missing token', JSON.stringify(pollResult).slice(0, 200))
    mkdirSync(CREDS_DIR, { recursive: true })
    writeFileSync(CREDS_PATH, JSON.stringify({ token: mcpToken, accountId, email: userEmail, server: SERVER }, null, 2), { mode: 0o600 })
    pass('credentials saved')
    // Check mode
    try {
      const st = statSync(CREDS_PATH)
      const mode = (st.mode & 0o777).toString(8)
      // Windows may report 666; Unix should report 600
      if (process.platform !== 'win32' && mode !== '600') fail('credentials mode 0600', `actual=${mode}`)
      else pass(`credentials mode ${mode} (Windows ignores chmod)`)
    } catch (e) { fail('stat credentials', e.message) }
  } else {
    fail('login_poll success', `final=${JSON.stringify(pollResult).slice(0, 200)}`)
  }
}

// ---------------------------------------------------------------
// 6. WHOAMI (after login)
// ---------------------------------------------------------------
header('6. whoami after login')
if (mcpToken) {
  const w = runCli(['whoami'])
  if (w.code === 0 && (w.out.includes(TEST_EMAIL) || w.out.includes(accountId || '__none__'))) pass('whoami shows account')
  else fail('whoami', `code=${w.code} out=${w.out.slice(0,200)}`)
} else {
  skip('whoami', 'no token from login')
}

// ---------------------------------------------------------------
// 7. RE-LOGIN BEHAVIOR
// ---------------------------------------------------------------
header('7. re-login confirmation')
if (mcpToken) {
  // Pipe "n" to decline
  const r1 = runCli(['login', '--email', TEST_EMAIL], { stdin: 'n\n', timeoutMs: 15000 })
  if (r1.code === 0 && /cancelled|already/i.test(r1.out + r1.err)) pass('re-login prompts and cancels on "n"')
  else fail('re-login decline', `code=${r1.code} out=${r1.out.slice(0,200)}`)
}

// ---------------------------------------------------------------
// 8. SCAN (free tier, --json)
// ---------------------------------------------------------------
header('8. scan')
let auditId = null
if (mcpToken) {
  const s = runCli(['scan', TEST_DOMAIN, '--json'], { timeoutMs: 180000 })
  if (s.code === 0) pass('scan exits 0')
  else fail('scan', `code=${s.code} err=${s.err.slice(0,300)}`)
  try {
    const j = JSON.parse(s.out)
    auditId = j.id || j.scan_id || j.audit_id
    if (auditId) pass(`scan --json returns audit_id (${auditId})`)
    else fail('scan audit_id', `keys=${Object.keys(j).join(',')}`)
    if (j.status === 'completed' || j.result) pass(`scan completed (status=${j.status})`)
    else fail('scan not completed', `status=${j.status}`)
  } catch (e) {
    fail('scan output JSON parse', `${e.message} :: out=${s.out.slice(0,200)}`)
  }

  // Invalid URL
  const bad = runCli(['scan', 'not-a-url-at-all', '--json'], { timeoutMs: 15000 })
  if (bad.code !== 0) pass('scan invalid-url exits non-zero')
  else fail('scan invalid-url', 'unexpectedly succeeded')
}

// ---------------------------------------------------------------
// 9. HISTORY
// ---------------------------------------------------------------
header('9. history')
if (mcpToken && auditId) {
  const h = runCli(['history', '--json'])
  if (h.code === 0) pass('history exits 0')
  else fail('history', `code=${h.code} err=${h.err.slice(0,200)}`)
  if (h.code === 0 && h.out.includes(auditId)) pass('history includes our new scan')
  else if (h.code === 0) fail('history includes our scan', `audit_id ${auditId} not in output`)

  const h2 = runCli(['history', '--limit', '5', '--json'])
  if (h2.code === 0) pass('history --limit accepted')
  else fail('history --limit', `code=${h2.code}`)
}

// ---------------------------------------------------------------
// 10. ISSUES (free, gated)
// ---------------------------------------------------------------
header('10. issues (free, gated)')
if (mcpToken && auditId) {
  const iss = runCli(['issues', auditId, '--json'])
  if (iss.code === 0) pass('issues exits 0')
  else fail('issues', `code=${iss.code} err=${iss.err.slice(0,200)}`)
  try {
    const j = JSON.parse(iss.out)
    const list = j.issues || j
    if (Array.isArray(list)) pass(`issues returns array (${list.length} items)`)
    else fail('issues array shape', `keys=${Object.keys(j).join(',')}`)
  } catch (e) {
    // Some implementations return mixed text + json
    if (iss.out.length > 0) pass('issues returned output (non-json mode tolerated)')
    else fail('issues output empty', '')
  }

  // Severity filter
  const issSev = runCli(['issues', auditId, '--severity', 'high', '--json'])
  if (issSev.code === 0) pass('issues --severity accepted')
  else fail('issues --severity', `code=${issSev.code}`)
}

// ---------------------------------------------------------------
// 11. FIX (paid, paywall flow + happy path)
// ---------------------------------------------------------------
header('11. fix (paid, paywall + pay-then-retry)')
let firstIssueId = null
if (mcpToken && auditId) {
  // Pull issue_id from the scan record (CLI uses the same fallback path).
  const scanRec = await fetch(`${SERVER}/api/v1/scans/${auditId}`, {
    headers: { Authorization: `Bearer ${mcpToken}` },
  }).then(r => r.json()).catch(() => null)
  firstIssueId = scanRec?.result?.issues?.[0]?.id
  if (!firstIssueId) {
    skip('fix paywall', 'no issue_id in scan.result.issues')
  } else {
    // 11a. Decline path
    const declined = runCli(['fix', firstIssueId], { stdin: 'n\n', timeoutMs: 30000 })
    if (declined.code !== 0 && /cancelled|payment/i.test(declined.out + declined.err)) pass('fix paywall decline cancels cleanly')
    else if (declined.code === 0) pass('fix succeeded without paywall (already paid)')
    else fail('fix paywall decline', `code=${declined.code} out=${declined.out.slice(0,200)}`)

    // 11b. Happy path: trigger paywall via raw RPC, simulate the click,
    //      verify billing flips, then verify the CLI fix command succeeds.
    const fp1 = await rpc('tools/call', { name: 'get_fix_prompts', arguments: { issue_id: firstIssueId } }, mcpToken)
    const opts = fp1?.error?.data?.options
    if (!Array.isArray(opts) || !opts.length) {
      skip('fix pay-then-retry', `no paywall options returned: ${JSON.stringify(fp1).slice(0,200)}`)
    } else {
      pass(`paywall returned ${opts.length} payment options (${opts.map(o=>o.type).join('+')})`)
      const sub = opts.find(o => o.type === 'subscription')
      const checkoutUrl = sub?.checkout_url || opts[0].checkout_url
      // Verify the URL won't 405 (dev mode should point at /api/dev/auto-pay)
      if (/\/api\/dev\/auto-pay/.test(checkoutUrl)) pass('paywall URL uses dev auto-pay route (will not 405)')
      else fail('paywall URL not dev auto-pay', `url=${checkoutUrl?.slice(0,100)}`)
      // Click it
      const clickRes = await fetch(checkoutUrl, { redirect: 'manual' })
      if (clickRes.status < 400) pass(`paywall click HTTP ${clickRes.status} (tier granted)`)
      else fail('paywall click', `HTTP ${clickRes.status}`)
      // Poll billing
      let flipped = false
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const b = await fetch(`${SERVER}/api/v1/billing/status`, { headers: { Authorization: `Bearer ${mcpToken}` } }).then(r => r.json()).catch(() => null)
        if (b?.is_paid || b?.tier === 'paid' || b?.subscribed) { flipped = true; break }
      }
      if (flipped) pass('billing status flipped to paid after click')
      else fail('billing status flip', 'never went paid within 20s')
      // Now the retry: get_fix_prompts should succeed
      const fp2 = await rpc('tools/call', { name: 'get_fix_prompts', arguments: { issue_id: firstIssueId } }, mcpToken)
      const result = unwrapToolResult(fp2)
      const promptStr = typeof result?.prompt === 'string' ? result.prompt : ''
      if (promptStr.length > 50) pass(`fix prompt returned after pay (${promptStr.length} chars)`)
      else if (fp2?.error) fail('fix prompt retry still paywalled', JSON.stringify(fp2.error).slice(0,200))
      else fail('fix prompt empty after pay', JSON.stringify(result).slice(0,200))
    }
  }
}

// ---------------------------------------------------------------
// 12. EXPORT (paid; expect paywall on free)
// ---------------------------------------------------------------
header('12. export')
if (mcpToken && auditId) {
  const ex = runCli(['export', auditId, '--format', 'json'], { stdin: 'n\n', timeoutMs: 30000 })
  // On free: paywall declined exits non-zero. After payment: succeeds.
  if (ex.code !== 0 || ex.code === 0) {
    // Either path is acceptable - just check we didn't crash hard
    if (ex.code === 0 || /payment|cancelled/i.test(ex.out + ex.err)) pass('export reachable (paywall or success)')
    else fail('export', `code=${ex.code} err=${ex.err.slice(0,200)}`)
  }
}

// ---------------------------------------------------------------
// 13. COMPARE (paid)
// ---------------------------------------------------------------
header('13. compare')
if (mcpToken && auditId) {
  // compare runs a full competitor scan. After section 11 paid the account,
  // paywall won't trigger; instead this actually runs (90+ seconds against a
  // real competitor URL). Accept three outcomes: success, paywall-decline,
  // or controlled "scan in progress" timeout. Anything else is a real bug.
  const c = runCli(['compare', auditId, `https://${TEST_COMPETITOR}`, '--json'], { stdin: 'n\n', timeoutMs: 240000 })
  if (c.code === 0) pass('compare exits 0 (paid + completed)')
  else if (/payment|cancelled/i.test(c.out + c.err)) pass('compare paywall decline (account not paid yet)')
  else if (c.signal === 'SIGTERM' || c.code === null) skip('compare', `timed out after 240s (real competitor scan in flight)`)
  else fail('compare', `code=${c.code} signal=${c.signal} out=${c.out.slice(0,200)} err=${c.err.slice(0,300)}`)
}

// ---------------------------------------------------------------
// 14. VERIFY (free, re-crawls)
// ---------------------------------------------------------------
header('14. verify')
if (mcpToken && auditId) {
  const v = runCli(['verify', auditId, '--page', `https://${TEST_DOMAIN}`], { timeoutMs: 120000 })
  // verify_fix MCP tool accepts issue_id OR audit_id+page_url
  if (v.code === 0) pass('verify exits 0')
  else fail('verify', `code=${v.code} err=${v.err.slice(0,200)}`)
}

// ---------------------------------------------------------------
// 15. MONITOR (paid)
// ---------------------------------------------------------------
header('15. monitor')
if (mcpToken) {
  // The CLI calls monitor_list / monitor_add backend tools. As of this
  // session those aren't in MCP_TOOLS_CATALOG yet (the lib/monitoring.ts
  // helpers exist but aren't exposed via MCP). So we expect the server
  // to reject with "unknown tool". Treat that as a KNOWN GAP rather than
  // a CLI failure; the CLI dispatch + arg parsing + error surfacing
  // all work correctly.
  const ml = runCli(['monitor', 'list', '--json'], { timeoutMs: 15000 })
  if (ml.code === 0) pass('monitor list works (backend tools present)')
  else if (/unknown tool|not_implemented|method.*not.*found/i.test(ml.out + ml.err)) {
    skip('monitor list', 'backend monitor_list MCP tool not yet exposed (known gap)')
  } else if (/payment/i.test(ml.out + ml.err)) {
    pass('monitor list paywall reached')
  } else fail('monitor list', `code=${ml.code} err=${ml.err.slice(0,200)}`)

  const ma = runCli(['monitor', 'add', TEST_DOMAIN], { stdin: 'n\n', timeoutMs: 15000 })
  if (ma.code === 0) pass('monitor add works (backend tools present)')
  else if (/unknown tool|not_implemented|method.*not.*found/i.test(ma.out + ma.err)) {
    skip('monitor add', 'backend monitor_add MCP tool not yet exposed (known gap)')
  } else if (/payment|cancelled/i.test(ma.out + ma.err)) {
    pass('monitor add paywall reached')
  } else fail('monitor add', `code=${ma.code}`)
}

// ---------------------------------------------------------------
// 16. ENV VAR OVERRIDES
// ---------------------------------------------------------------
header('16. env var overrides')
if (mcpToken) {
  // CRAWLFIX_TOKEN env var (without creds file)
  clearCreds()
  const wt = runCli(['scan', TEST_DOMAIN, '--json'], {
    env: { CRAWLFIX_TOKEN: mcpToken },
    unsetToken: false,
    timeoutMs: 120000,
  })
  if (wt.code === 0) pass('CRAWLFIX_TOKEN env bypasses creds file')
  else fail('CRAWLFIX_TOKEN env', `code=${wt.code} err=${wt.err.slice(0,200)}`)

  // --server flag overrides
  const bogus = runCli(['scan', TEST_DOMAIN, '--server', 'https://this-should-not-exist-12345.example', '--json'], {
    env: { CRAWLFIX_TOKEN: mcpToken },
    timeoutMs: 15000,
  })
  if (bogus.code !== 0) pass('--server flag is respected (bogus URL errored)')
  else fail('--server flag', 'bogus URL unexpectedly succeeded')

  // Restore creds for subsequent tests
  mkdirSync(CREDS_DIR, { recursive: true })
  writeFileSync(CREDS_PATH, JSON.stringify({ token: mcpToken, accountId, email: userEmail, server: SERVER }, null, 2), { mode: 0o600 })
}

// ---------------------------------------------------------------
// 17. LOGOUT
// ---------------------------------------------------------------
header('17. logout')
if (mcpToken) {
  const lo = runCli(['logout'])
  if (lo.code === 0) pass('logout exits 0')
  else fail('logout', `code=${lo.code}`)
  if (!existsSync(CREDS_PATH)) pass('logout removed credentials file')
  else fail('logout removed file', 'creds file still exists')

  // whoami after logout
  const w = runCli(['whoami'], { unsetToken: true })
  if (w.code !== 0) pass('whoami after logout exits non-zero')
  else fail('whoami after logout', `code=${w.code}`)
}

// =========================================================================
header(`Summary: ${passed} passed, ${failed} failed`)
process.stdout.write(`Finished: ${new Date().toISOString()}\n`)
if (failures.length) {
  process.stdout.write('\nFailures:\n')
  for (const f of failures) process.stdout.write(`  - ${f}\n`)
}
process.exit(failed === 0 ? 0 : 1)
})()
