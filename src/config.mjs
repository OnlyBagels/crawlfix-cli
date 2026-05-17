// Credential and server-URL resolution for the Crawlfix CLI.

import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { promises as fs, constants as fsConstants } from 'node:fs'

export const DEFAULT_SERVER = 'https://crawlfix.ai'

export function getCredentialsDir() {
  return join(homedir(), '.crawlfix')
}

export function getCredentialsPath() {
  return join(getCredentialsDir(), 'credentials.json')
}

export async function loadCredentials() {
  try {
    const raw = await fs.readFile(getCredentialsPath(), 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object') return data
    return null
  } catch {
    return null
  }
}

export async function saveCredentials(creds) {
  const dir = getCredentialsDir()
  await fs.mkdir(dir, { recursive: true })
  const path = getCredentialsPath()
  const json = JSON.stringify(creds, null, 2)
  // Write atomically when possible and lock down permissions (POSIX).
  await fs.writeFile(path, json, { encoding: 'utf8', mode: 0o600 })
  try { await fs.chmod(path, 0o600) } catch { /* Windows: chmod is a no-op */ }
}

export async function clearCredentials() {
  try {
    await fs.unlink(getCredentialsPath())
    return true
  } catch (err) {
    if (err && err.code === 'ENOENT') return false
    throw err
  }
}

export function resolveServer(flagValue, creds) {
  if (flagValue && typeof flagValue === 'string') return stripTrailingSlash(flagValue)
  if (process.env.CRAWLFIX_SERVER) return stripTrailingSlash(process.env.CRAWLFIX_SERVER)
  if (creds && creds.server) return stripTrailingSlash(creds.server)
  return DEFAULT_SERVER
}

export function resolveToken(creds) {
  if (process.env.CRAWLFIX_TOKEN) return process.env.CRAWLFIX_TOKEN
  if (creds && creds.token) return creds.token
  return null
}

function stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

// Best-effort: ensure the parent dir exists even if we never wrote credentials.
export async function ensureCredentialsDir() {
  await fs.mkdir(getCredentialsDir(), { recursive: true })
}

// Used in a couple of places to silence "file not present" errors.
export async function fileExists(path) {
  try {
    await fs.access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

// `dirname` is re-exported so callers don't have to import node:path themselves.
export { dirname }
