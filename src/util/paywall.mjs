// Pay-via-CLI flow.
//
// When a paid command returns PaymentRequiredError, we list the offered
// options, prompt the user to pick one, open the checkout URL in their
// browser, then poll the billing endpoint until the tier flips to paid.
// Once paid, we retry the original API call exactly once.

import { color, prompt } from './output.mjs'
import { openInBrowser } from './browser.mjs'
import { pollUntil, sleep } from './poll.mjs'
import { PaymentRequiredError, callMcp, callRest } from '../api.mjs'

const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 15 * 60_000

export async function withPaywall(ctx, fn) {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof PaymentRequiredError)) throw err
    const upgraded = await runPaywallFlow(ctx, err)
    if (!upgraded) {
      const e = new Error('Payment cancelled.')
      e.exitCode = 1
      throw e
    }
    return await fn()
  }
}

async function runPaywallFlow(ctx, err) {
  const { server, token } = ctx
  const options = Array.isArray(err.options) ? err.options : []
  process.stdout.write('\n')
  process.stdout.write(color.bold('This action requires a paid tier.') + '\n\n')
  if (options.length === 0) {
    process.stdout.write('  No checkout options were returned by the server.\n')
    process.stdout.write('  Visit https://crawlfix.ai/pricing to upgrade, then re-run this command.\n')
    return false
  }
  options.forEach((o, i) => {
    const price = o.price ? color.cyan(o.price) : ''
    process.stdout.write(`  ${i + 1}) ${color.bold(o.name || o.type || 'Option')}   ${price}\n`)
    if (o.unlocks) process.stdout.write(`     ${color.gray(o.unlocks)}\n`)
  })
  process.stdout.write('\n')
  const choices = options.map((_, i) => String(i + 1))
  const answer = await prompt(`Pick one (${choices.join(' or ')}, or 'n' to cancel): `)
  const trimmed = (answer || '').trim().toLowerCase()
  if (trimmed === 'n' || trimmed === 'no' || trimmed === '') return false
  const idx = parseInt(trimmed, 10) - 1
  if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) {
    process.stdout.write(color.red('Invalid choice. Cancelling.') + '\n')
    return false
  }
  const pick = options[idx]
  const url = pick.checkout_url
  if (!url) {
    process.stdout.write(color.red('Server did not return a checkout URL. Cancelling.') + '\n')
    return false
  }
  process.stdout.write(`\nOpening checkout in your browser...\n${color.gray(url)}\n\n`)
  const opened = openInBrowser(url)
  if (!opened) {
    process.stdout.write(color.yellow('Could not auto-open your browser. Please visit the URL above manually.') + '\n\n')
  }
  process.stdout.write('Waiting for payment confirmation (this can take a minute or two)...\n')
  const auditId = pick.audit_id || err.auditId
  const paid = await waitForPayment({ server, token, auditId })
  if (!paid) {
    process.stdout.write(color.red('Payment not confirmed within the time limit. Cancelling.') + '\n')
    return false
  }
  process.stdout.write(color.green('Payment confirmed. Retrying your previous command...') + '\n\n')
  return true
}

async function waitForPayment({ server, token, auditId }) {
  try {
    return await pollUntil(async () => {
      const isPaid = await checkTier({ server, token, auditId })
      if (isPaid) return { done: true, value: true }
      return { done: false }
    }, { intervalMs: POLL_INTERVAL_MS, timeoutMs: POLL_TIMEOUT_MS })
  } catch {
    return false
  }
}

async function checkTier({ server, token, auditId }) {
  // First try the documented REST status endpoint. If it 404s, fall back to
  // the MCP get_tier_status / get_audit tools. We treat any signal of
  // tier === 'paid' OR subscription_active OR audit-level unlock as success.
  try {
    const status = await callRest({
      server, token, method: 'GET',
      path: '/api/v1/billing/status',
      query: auditId ? { audit_id: auditId } : undefined,
    })
    if (status && (status.tier === 'paid' || status.paid === true || status.subscription_active === true || status.unlocked === true)) {
      return true
    }
  } catch {
    // ignore; try MCP fallback
  }
  try {
    const status = await callMcp({ server, token, tool: 'get_tier_status', args: auditId ? { audit_id: auditId } : {} })
    if (status && (status.tier === 'paid' || status.subscription_active === true || status.paid === true)) {
      return true
    }
  } catch {
    // ignore; will be retried on the next poll tick
  }
  // Tiny safety sleep so a misbehaving server doesn't get hammered.
  await sleep(0)
  return false
}
