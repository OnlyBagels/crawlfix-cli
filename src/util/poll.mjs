// Generic polling helper.
//
// pollUntil(fn, { intervalMs, timeoutMs, onTick }) calls fn() repeatedly.
// fn should return { done: true, value } to stop polling, or { done: false }
// to keep going. Throws an Error if timeoutMs elapses first.

export async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function pollUntil(fn, { intervalMs = 3000, timeoutMs = 15 * 60_000, onTick } = {}) {
  const start = Date.now()
  let tick = 0
  let currentInterval = intervalMs
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const elapsed = Date.now() - start
    if (elapsed > timeoutMs) {
      throw new Error(`Polling timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    const res = await fn({ tick, elapsed })
    if (res && res.done) return res.value
    if (onTick) {
      try { onTick(tick) } catch { /* ignore */ }
    }
    if (res && typeof res.nextIntervalMs === 'number') {
      currentInterval = res.nextIntervalMs
    }
    tick += 1
    await sleep(currentInterval)
  }
}
