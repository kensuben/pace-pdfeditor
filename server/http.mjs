export const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024
export const ACTION_REGEX = /^[a-z0-9._-]+$/

export function parseBodyLimit(val = process.env.API_BODY_LIMIT_BYTES) {
  if (val === undefined || val === '') return DEFAULT_BODY_LIMIT_BYTES
  const num = Number(val)
  if (Number.isInteger(num) && num > 0) return num
  console.warn(`[HTTP CONFIG WARNING] Invalid API_BODY_LIMIT_BYTES: "${val}". Using default ${DEFAULT_BODY_LIMIT_BYTES} bytes.`)
  return DEFAULT_BODY_LIMIT_BYTES
}

export async function readJsonBody(req, { limitBytes = parseBodyLimit() } = {}) {
  let size = 0
  const chunks = []

  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) {
      if (typeof req.destroy === 'function') {
        req.destroy()
      }
      const err = new Error('Request body too large')
      err.status = 413
      throw err
    }
    chunks.push(chunk)
  }

  if (chunks.length === 0 || size === 0) {
    return {}
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) {
    return {}
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    const err = new Error('Invalid JSON body')
    err.status = 400
    throw err
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const err = new Error('Invalid JSON body')
    err.status = 400
    throw err
  }

  return parsed
}

export function validateActivityInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const err = new Error('Dữ liệu activity không hợp lệ')
    err.status = 400
    throw err
  }

  const action = typeof input.action === 'string' ? input.action.trim() : ''
  if (!action || action.length < 1 || action.length > 100 || !ACTION_REGEX.test(action)) {
    const err = new Error('action không hợp lệ')
    err.status = 400
    throw err
  }

  const description = typeof input.description === 'string'
    ? input.description.slice(0, 500)
    : ''

  const allowedLevels = ['info', 'success', 'warning', 'security']
  const level = allowedLevels.includes(input.level) ? input.level : 'info'

  const sessionId = typeof input.sessionId === 'string'
    ? input.sessionId.slice(0, 100)
    : ''

  const metadata = {}
  if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
    const keys = Object.keys(input.metadata).slice(0, 20)
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > 50) continue
      const val = input.metadata[key]
      if (typeof val === 'string') {
        metadata[key] = val.slice(0, 200)
      } else if (typeof val === 'number') {
        if (Number.isFinite(val)) metadata[key] = val
      } else if (typeof val === 'boolean') {
        metadata[key] = val
      } else if (val === null) {
        metadata[key] = null
      }
    }
  }

  return {
    action,
    description,
    level,
    sessionId,
    metadata,
  }
}
