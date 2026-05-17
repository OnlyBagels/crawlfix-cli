// HTTP client wrapper for the Crawlfix backend.
//
// Two transports:
//   1. callMcp  -> POST {server}/api/mcp/rpc with a JSON-RPC envelope.
//   2. callRest -> Plain REST against {server}{path}.
//
// Both auto-inject `Authorization: Bearer <token>` when a token is supplied.

let _rpcId = 0
function nextRpcId() {
  _rpcId += 1
  return _rpcId
}

export class RpcError extends Error {
  constructor(code, message, data) {
    super(message || `RPC error ${code}`)
    this.name = 'RpcError'
    this.code = code
    this.data = data
  }
}

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message || `HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

export class PaymentRequiredError extends Error {
  constructor(toolName, auditId, options) {
    super(`Payment required for ${toolName || 'this action'}`)
    this.name = 'PaymentRequiredError'
    this.toolName = toolName
    this.auditId = auditId
    this.options = options || []
  }
}

function buildHeaders(token, extra = {}) {
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json',
    'user-agent': 'crawlfix-cli/0.1.0',
    ...extra,
  }
  if (token) headers['authorization'] = `Bearer ${token}`
  return headers
}

export async function callMcp({ server, token, tool, args = {}, timeoutMs = 60_000 }) {
  if (!server) throw new Error('callMcp: server is required')
  if (!tool) throw new Error('callMcp: tool is required')
  const url = `${server}/api/mcp/rpc`
  const body = {
    jsonrpc: '2.0',
    id: nextRpcId(),
    method: 'tools/call',
    params: { name: tool, arguments: args },
  }
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`)
    }
    throw new Error(`Request to ${url} failed: ${err.message}`)
  } finally {
    clearTimeout(t)
  }
  const text = await res.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : {} } catch {
    throw new HttpError(res.status, `Non-JSON response from MCP endpoint`, text)
  }
  if (!res.ok && !parsed?.error) {
    throw new HttpError(res.status, `MCP HTTP ${res.status}`, parsed)
  }
  if (parsed.error) {
    const { code, message, data } = parsed.error
    // Payment-required mapping: JSON-RPC code -32001, data.error_type === 'payment_required'.
    if (code === -32001 || (data && data.error_type === 'payment_required')) {
      throw new PaymentRequiredError(data?.tool || tool, data?.audit_id, data?.options || [])
    }
    throw new RpcError(code, message, data)
  }
  // Unwrap the MCP tools/call response. Tool handlers return either:
  //   { content: [{ type: 'text', text: '...JSON...' }] }
  // or a plain object. Try to decode the text payload when present.
  const result = parsed.result
  if (result && Array.isArray(result.content) && result.content.length === 1 && result.content[0]?.type === 'text') {
    const inner = result.content[0].text
    try { return JSON.parse(inner) } catch { return inner }
  }
  return result
}

export async function callRest({ server, token, method = 'GET', path, body, query, timeoutMs = 60_000, accept }) {
  if (!server) throw new Error('callRest: server is required')
  if (!path) throw new Error('callRest: path is required')
  const qs = query ? `?${new URLSearchParams(query).toString()}` : ''
  const url = `${server}${path}${qs}`
  const headers = buildHeaders(token, accept ? { accept } : {})
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`)
    }
    throw new Error(`Request to ${url} failed: ${err.message}`)
  } finally {
    clearTimeout(t)
  }
  const ct = res.headers.get('content-type') || ''
  if (accept && !ct.includes('application/json') && !accept.includes('application/json')) {
    // Binary or HTML response: return the raw buffer + status info.
    const buf = Buffer.from(await res.arrayBuffer())
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} from ${path}`, buf)
    return { status: res.status, headers: res.headers, body: buf }
  }
  const text = await res.text()
  let parsed = null
  if (text) {
    try { parsed = JSON.parse(text) } catch { parsed = text }
  }
  if (res.status === 402) {
    // Backend has not standardised a 402 shape yet, but spec mentions it.
    const opts = (parsed && typeof parsed === 'object' && Array.isArray(parsed.options)) ? parsed.options : []
    throw new PaymentRequiredError(parsed?.tool, parsed?.audit_id, opts)
  }
  if (!res.ok) {
    const message = (parsed && typeof parsed === 'object' && parsed.error) ? parsed.error : `HTTP ${res.status} from ${path}`
    throw new HttpError(res.status, message, parsed)
  }
  return parsed
}
