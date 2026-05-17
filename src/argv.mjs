// Tiny zero-dep argv parser.
//
// Supports:
//   - positional args:        crawlfix scan example.com         -> _: ['scan', 'example.com']
//   - long flags:             --json                            -> json: true
//                             --limit 20                        -> limit: '20'
//                             --limit=20                        -> limit: '20'
//                             --no-wait                         -> wait: false
//   - short flags & aliases:  -h / -v                           -> help / version

const ALIASES = {
  h: 'help',
  v: 'version',
}

export function parseArgv(args) {
  const out = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') {
      out._.push(...args.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      let key = eq === -1 ? a.slice(2) : a.slice(2, eq)
      let val = eq === -1 ? undefined : a.slice(eq + 1)
      if (key.startsWith('no-') && val === undefined) {
        out[camel(key.slice(3))] = false
        continue
      }
      if (val === undefined) {
        const next = args[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          val = next
          i++
        } else {
          val = true
        }
      }
      out[camel(key)] = val
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      // Short flag: -h or -h something
      const k = a.slice(1)
      const long = ALIASES[k] || k
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        out[long] = next
        i++
      } else {
        out[long] = true
      }
      continue
    }
    out._.push(a)
  }
  return out
}

function camel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}
