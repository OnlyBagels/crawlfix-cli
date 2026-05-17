// Terminal output helpers: ANSI color, box drawing, simple ASCII table,
// spinner, severity / category palettes, score-band labels.
//
// Colors are disabled when NO_COLOR is set, when stdout is not a TTY, or
// when --no-color is passed (callers can also call disableColor()).
// FORCE_COLOR=1 re-enables them.

const FORCE = process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === 'true'
let COLOR_ENABLED = FORCE || (!process.env.NO_COLOR && !!process.stdout.isTTY)

export function disableColor() { COLOR_ENABLED = false }
export function enableColor() { COLOR_ENABLED = true }
export function colorEnabled() { return COLOR_ENABLED }

function wrap(open, close) {
  return s => (COLOR_ENABLED ? `\x1b[${open}m${s}\x1b[${close}m` : String(s))
}

export const color = {
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  redBold: s => (COLOR_ENABLED ? `\x1b[1;31m${s}\x1b[0m` : String(s)),
}

export function severityColor(severity) {
  const s = String(severity || '').toLowerCase()
  if (s === 'critical') return color.redBold
  if (s === 'high') return color.red
  if (s === 'medium' || s === 'med') return color.yellow
  if (s === 'low') return color.blue
  if (s === 'info') return color.gray
  return v => String(v)
}

// Canonical 8 categories. Color choices roughly match the web ReportView palette.
const CATEGORY_COLORS = {
  'security': color.red,
  'seo': color.green,
  'performance': color.yellow,
  'ai optimization': color.magenta,
  'accessibility': color.cyan,
  'trust & legitimacy': color.blue,
  'content quality': color.gray,
  'mobile': color.cyan,
}

export function categoryColor(category) {
  const key = String(category || '').toLowerCase()
  return CATEGORY_COLORS[key] || (v => String(v))
}

export function scoreBandLabel(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return 'Unknown'
  if (n < 20) return 'Danger Zone'
  if (n < 40) return 'Risky Territory'
  if (n < 60) return 'Caution Advised'
  if (n < 80) return 'Trusted but Verify'
  return 'Safe & Secure'
}

export function scoreColor(score) {
  const n = Number(score)
  if (!Number.isFinite(n)) return v => String(v)
  if (n < 40) return color.red
  if (n < 60) return color.yellow
  if (n < 80) return color.cyan
  return color.green
}

// Strip ANSI escapes so width math doesn't get thrown off by color codes.
const ANSI_RE = /\x1b\[[0-9;]*m/g
export function stripAnsi(s) { return String(s).replace(ANSI_RE, '') }
export function visibleLength(s) { return stripAnsi(s).length }

export function pad(s, width, align = 'left') {
  const len = visibleLength(s)
  if (len >= width) return s
  const diff = width - len
  if (align === 'right') return ' '.repeat(diff) + s
  if (align === 'center') {
    const l = Math.floor(diff / 2)
    return ' '.repeat(l) + s + ' '.repeat(diff - l)
  }
  return s + ' '.repeat(diff)
}

export function box(text, { title } = {}) {
  const lines = String(text).split('\n')
  const maxLen = Math.max(...lines.map(visibleLength), title ? visibleLength(title) + 2 : 0)
  const width = Math.min(maxLen, 100)
  const top = title
    ? `┌─ ${title} ${'─'.repeat(Math.max(0, width - visibleLength(title) - 3))}┐`
    : `┌${'─'.repeat(width + 2)}┐`
  const bottom = `└${'─'.repeat(width + 2)}┘`
  const middle = lines.map(l => `│ ${pad(l, width)} │`).join('\n')
  return `${top}\n${middle}\n${bottom}`
}

export function table(rows, headers) {
  if (!rows || rows.length === 0) return headers ? headers.join('  ') : ''
  const cols = headers ? headers.map(h => h.key || h) : Object.keys(rows[0])
  const labels = headers ? headers.map(h => h.label || h.key || h) : cols
  const widths = cols.map((c, i) => {
    let w = visibleLength(labels[i])
    for (const r of rows) {
      const v = r[c] == null ? '' : String(r[c])
      if (visibleLength(v) > w) w = visibleLength(v)
    }
    return w
  })
  const header = labels.map((l, i) => color.bold(pad(l, widths[i]))).join('  ')
  const body = rows.map(r =>
    cols.map((c, i) => pad(r[c] == null ? '' : String(r[c]), widths[i])).join('  '),
  ).join('\n')
  return `${header}\n${body}`
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function spinner(label = '') {
  let frame = 0
  let active = false
  const isTTY = !!process.stdout.isTTY
  function paint(text) {
    if (!isTTY) return
    process.stdout.write(`\r${text}`)
  }
  function clearLine() {
    if (!isTTY) return
    process.stdout.write('\r\x1b[2K')
  }
  return {
    start(initialLabel) {
      if (initialLabel !== undefined) label = initialLabel
      active = true
      if (isTTY) {
        paint(`${SPINNER_FRAMES[0]} ${label}`)
      } else if (label) {
        process.stdout.write(`${label}\n`)
      }
    },
    tick(newLabel) {
      if (!active) return
      if (newLabel !== undefined) label = newLabel
      if (isTTY) {
        frame = (frame + 1) % SPINNER_FRAMES.length
        paint(`${SPINNER_FRAMES[frame]} ${label}`)
      }
    },
    update(newLabel) {
      label = newLabel
      if (isTTY && active) {
        paint(`${SPINNER_FRAMES[frame]} ${label}`)
      } else if (active && newLabel) {
        process.stdout.write(`${newLabel}\n`)
      }
    },
    stop(finalLine) {
      active = false
      clearLine()
      if (finalLine) process.stdout.write(`${finalLine}\n`)
    },
    success(msg) {
      active = false
      clearLine()
      process.stdout.write(`${color.green('✓')} ${msg}\n`)
    },
    fail(msg) {
      active = false
      clearLine()
      process.stdout.write(`${color.red('✗')} ${msg}\n`)
    },
  }
}

// Tiny prompt helper. Returns a single line from stdin. Caller renders the prompt.
export async function prompt(question) {
  process.stdout.write(question)
  return new Promise(resolve => {
    process.stdin.setEncoding('utf8')
    const onData = chunk => {
      process.stdin.removeListener('data', onData)
      process.stdin.pause()
      resolve(String(chunk).trim())
    }
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}
