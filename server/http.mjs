export const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024
export const ACTION_REGEX = /^[a-z0-9._-]+$/

export function parseBodyLimit(val = process.env.API_BODY_LIMIT_BYTES) {
  if (val === undefined || val === '') return DEFAULT_BODY_LIMIT_BYTES
  const num = Number(val)
  if (Number.isInteger(num) && num > 0) return num
  console.warn(`[HTTP CONFIG WARNING] Invalid API_BODY_LIMIT_BYTES: "${val}". Using default ${DEFAULT_BODY_LIMIT_BYTES} bytes.`)
  return DEFAULT_BODY_LIMIT_BYTES
}

export function readJsonBody(req, { limitBytes = parseBodyLimit() } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    let exceeded = false

    function onData(chunk) {
      if (exceeded) return
      size += chunk.length
      if (size > limitBytes) {
        exceeded = true
        cleanup()
        if (typeof req.on === 'function') {
          req.on('data', () => {})
        }
        if (typeof req.resume === 'function') {
          req.resume()
        }
        const err = new Error('Request body too large')
        err.status = 413
        reject(err)
        return
      }
      chunks.push(chunk)
    }

    function onEnd() {
      if (exceeded) return
      cleanup()
      if (chunks.length === 0 || size === 0) {
        return resolve({})
      }

      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        return resolve({})
      }

      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch {
        const err = new Error('Invalid JSON body')
        err.status = 400
        return reject(err)
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        const err = new Error('Invalid JSON body')
        err.status = 400
        return reject(err)
      }

      resolve(parsed)
    }

    function onError(err) {
      if (exceeded) return
      cleanup()
      reject(err)
    }

    function cleanup() {
      if (typeof req.removeListener === 'function') {
        req.removeListener('data', onData)
        req.removeListener('end', onEnd)
        req.removeListener('error', onError)
      }
    }

    if (typeof req.on === 'function') {
      req.on('data', onData)
      req.on('end', onEnd)
      req.on('error', onError)
    } else {
      resolve({})
    }
  })
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
