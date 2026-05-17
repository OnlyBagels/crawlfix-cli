#!/usr/bin/env node
// Crawlfix CLI entry point. Zero external dependencies; Node 18+ only.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseArgv } from '../src/argv.mjs'
import { commands } from '../src/commands/index.mjs'
import { color, disableColor } from '../src/util/output.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function readVersion() {
  try {
    const pkgPath = join(__dirname, '..', 'package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const argv = parseArgv(process.argv.slice(2))
if (argv.noColor) disableColor()

if (argv.version) {
  process.stdout.write(`${await readVersion()}\n`)
  process.exit(0)
}

const cmd = argv._[0]

if (!cmd || cmd === 'help' || (argv.help && !cmd)) {
  await commands.help.run(argv, { commands })
  process.exit(0)
}

const handler = commands[cmd]
if (!handler) {
  process.stderr.write(`Unknown command: ${cmd}\nRun 'crawlfix help' for the command list.\n`)
  process.exit(1)
}

if (argv.help) {
  if (handler.helpText) {
    process.stdout.write(handler.helpText + '\n')
    process.exit(0)
  }
  // Fall through and let the command emit its own help if it wants.
}

// Don't force `process.exit()` on success: on Node 24 + Windows, undici keeps
// fetch sockets in keep-alive briefly, and a hard exit while they're closing
// trips libuv's UV_HANDLE_CLOSING assertion (process crashes with
// STATUS_ACCESS_VIOLATION 0xC0000005 instead of returning 0). Setting
// `process.exitCode` and letting the event loop drain works on every
// platform. A 2-second unref'd timer forces exit if a leaked timer or socket
// keeps the loop alive too long.
try {
  await handler.run(argv, { commands })
  process.exitCode = 0
  setTimeout(() => process.exit(0), 2000).unref()
} catch (err) {
  const msg = err && err.message ? err.message : String(err)
  process.stderr.write(`${color.red('Error:')} ${msg}\n`)
  if (process.env.CRAWLFIX_DEBUG && err && err.stack) {
    process.stderr.write(err.stack + '\n')
  }
  const code = err && err.exitCode ? err.exitCode : 1
  process.exitCode = code
  setTimeout(() => process.exit(code), 2000).unref()
}
