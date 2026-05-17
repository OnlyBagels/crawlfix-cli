import { callMcp } from '../api.mjs'
import { loadCredentials, saveCredentials, resolveServer } from '../config.mjs'
import { color, prompt, spinner } from '../util/output.mjs'
import { openInBrowser } from '../util/browser.mjs'
import { sleep } from '../util/poll.mjs'

export const helpText = `
crawlfix login [--email <email>] [--server <url>] [--force]

  Authenticate this machine with Crawlfix using the device-authorization-grant
  flow. Opens a verification URL in your browser, waits for you to click the
  magic link, then stores an MCP token at ~/.crawlfix/credentials.json.

  Options:
    --email <email>   Pre-fill the email on the verification page.
    --server <url>    Backend server (default: https://crawlfix.ai).
    --force           Skip the "already logged in" confirmation.
`.trim()

export async function run(argv) {
  const existing = await loadCredentials()
  const server = resolveServer(argv.server, existing)
  if (existing && existing.token && !argv.force) {
    const who = existing.email ? ` as ${existing.email}` : ''
    const answer = await prompt(`Already logged in${who}. Re-login? [y/N] `)
    const yes = /^y(es)?$/i.test((answer || '').trim())
    if (!yes) {
      process.stdout.write('Login cancelled.\n')
      return
    }
  }
  const email = typeof argv.email === 'string' ? argv.email : undefined
  const args = email ? { email } : {}
  const initiated = await callMcp({ server, tool: 'login', args })
  // Tolerate either snake_case or camelCase keys from the server.
  const deviceCode = initiated.device_code || initiated.deviceCode
  const userCode = initiated.user_code || initiated.userCode
  const verifyUrlComplete = initiated.verification_url_complete || initiated.verificationUrlComplete
  const verifyUrl = initiated.verification_url || initiated.verificationUrl
  let pollInterval = (initiated.poll_interval || initiated.pollInterval || 3) * 1000
  const expiresIn = (initiated.expires_in || initiated.expiresIn || 600) * 1000
  if (!deviceCode || !userCode || !verifyUrl) {
    throw new Error('Login response missing device_code, user_code, or verification_url.')
  }
  process.stdout.write('\nOpen this URL in your browser to authorize:\n')
  process.stdout.write(`  ${color.cyan(verifyUrlComplete || verifyUrl)}\n`)
  process.stdout.write(`Or visit ${color.cyan(verifyUrl)} and enter code: ${color.bold(userCode)}\n\n`)
  openInBrowser(verifyUrlComplete || verifyUrl)
  const sp = spinner('Waiting for authorization...')
  sp.start()
  const deadline = Date.now() + expiresIn
  let intervalTick = setInterval(() => sp.tick(), 200)
  try {
    while (Date.now() < deadline) {
      await sleep(pollInterval)
      let res
      try {
        res = await callMcp({ server, tool: 'login_poll', args: { device_code: deviceCode } })
      } catch (err) {
        // Network blips: keep polling until the deadline.
        sp.update(`Waiting for authorization... ${color.gray('(retrying)')}`)
        continue
      }
      const status = res.status
      if (status === 'authorization_pending') continue
      if (status === 'slow_down') {
        const next = (res.poll_interval || res.pollInterval || 5) * 1000
        pollInterval = Math.max(pollInterval, next)
        continue
      }
      if (status === 'expired_token') {
        clearInterval(intervalTick)
        sp.fail('Login code expired. Run `crawlfix login` again.')
        const e = new Error('expired_token'); e.exitCode = 1; throw e
      }
      if (status === 'access_denied') {
        clearInterval(intervalTick)
        sp.fail('Login was denied.')
        const e = new Error('access_denied'); e.exitCode = 1; throw e
      }
      if (status === 'success') {
        clearInterval(intervalTick)
        const token = res.mcp_token || res.mcpToken || res.token
        const accountId = res.account_id || res.accountId
        const userEmail = res.email
        if (!token) {
          sp.fail('Login response was missing the token. Please contact support.')
          const e = new Error('missing token'); e.exitCode = 1; throw e
        }
        await saveCredentials({ token, accountId, email: userEmail, server })
        sp.success(`Logged in as ${color.bold(userEmail || accountId || 'unknown')}.`)
        process.stdout.write(`${color.gray('Server:')} ${server}\n`)
        return
      }
      // Unknown status: keep going, but show it.
      sp.update(`Waiting... (status: ${status})`)
    }
    clearInterval(intervalTick)
    sp.fail('Login timed out. Run `crawlfix login` again.')
    const e = new Error('timeout'); e.exitCode = 1; throw e
  } finally {
    clearInterval(intervalTick)
  }
}
