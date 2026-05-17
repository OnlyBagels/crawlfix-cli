#!/usr/bin/env node
// Smoke test for the Crawlfix CLI.
//
// Runs a small set of commands and asserts their exit codes.
// Defaults to CRAWLFIX_SERVER or http://localhost:7238.
//
// Usage:
//   node scripts/smoke-test.mjs
//   CRAWLFIX_SERVER=http://localhost:7238 node scripts/smoke-test.mjs

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BIN = join(__dirname, '..', 'bin', 'crawlfix.js')

const cases = [
  { argv: ['--version'], expect: 0, desc: 'prints version' },
  { argv: ['help'], expect: 0, desc: 'prints help' },
  { argv: ['help', 'scan'], expect: 0, desc: 'prints scan help' },
  { argv: ['scan'], expect: 2, desc: 'scan without url exits 2' },
  { argv: ['issues'], expect: 2, desc: 'issues without id exits 2' },
  { argv: ['bogus-command'], expect: 1, desc: 'unknown command exits 1' },
]

let failed = 0
for (const c of cases) {
  const res = spawnSync(process.execPath, [BIN, ...c.argv], {
    env: { ...process.env, NO_COLOR: '1' },
    encoding: 'utf8',
  })
  const got = res.status
  const ok = got === c.expect
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${c.desc}  (expected ${c.expect}, got ${got})\n`)
  if (!ok) failed += 1
}
process.exit(failed === 0 ? 0 : 1)
