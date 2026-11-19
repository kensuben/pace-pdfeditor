import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRemoteJWKSet } from 'jose'
import { validateAuthConfig, createTokenVerifier, authenticateUser } from './auth.mjs'
import { isValidEmail, normalizeUserPatch, assertAdminInvariant } from './users.mjs'
import { readJsonBody, validateActivityInput } from './http.mjs'
import {
  parseLogMaxInStore,
  recordSession,
  getOnlineUsers,
  cleanStaleSessions,
  CoalescedStore,
} from './store.mjs'
import { createShutdownHandler } from './lifecycle.mjs'

const port = Number(process.env.PORT || 3001)
const file = process.env.DATA_FILE || '/data/store.json'
const bootstrapAdmins = (process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)

const { clientId, tenantId } = validateAuthConfig({
  clientId: process.env.MICROSOFT_CLIENT_ID,
  tenantId: process.env.MICROSOFT_TENANT_ID,
})

const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`))
const verifyToken = createTokenVerifier({ clientId, tenantId, jwks })

let rawStore = { users: [], groups: [], logs: [] }
try {
  rawStore = JSON.parse(await readFile(file, 'utf8'))
} catch {
  // Store file does not exist yet; will be created on first save
}

const store = {
  users: Array.isArray(rawStore.users) ? rawStore.users : [],
  groups: Array.isArray(rawStore.groups) ? rawStore.groups : [],
  logs: Array.isArray(rawStore.logs) ? rawStore.logs : [],
}

const sessions = new Map()
const sessionCleanupInterval = setInterval(() => cleanStaleSessions(sessions), 5 * 60 * 1000)
sessionCleanupInterval.unref()

const storeManager = new CoalescedStore({
  file,
  getStore: () => store,
  delayMs: 500,
  logMaxInStore: parseLogMaxInStore(),
})

const save = () => storeManager.scheduleSave()

let server = null

const shutdown = createShutdownHandler({
  get server() {
    return server
  },
  storeManager,
})

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

const json = (res, status, data) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(data))
}



const tokenOf = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')

async function identity(req) {
  const token = tokenOf(req)
  if (!token) throw Object.assign(new Error('Missing token'), { status: 401 })
  const payload = await verifyToken(token)
  return authenticateUser({ payload, store, bootstrapAdmins, save })
}

const admin = user => {
  if (user.role !== 'admin') throw Object.assign(new Error('Admin required'), { status: 403 })
}

const route = (req, path) => new URL(req.url, `http://${req.headers.host}`).pathname === path

server = http.createServer(async (req, res) => {
  try {
    if (route(req, '/healthz')) return json(res, 200, { ok: true })
    const user = await identity(req)
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === 'POST' && route(req, '/api/auth/session')) {
      recordSession(sessions, user)
      return json(res, 200, { user })
    }

    if (req.method === 'POST' && route(req, '/api/heartbeat')) {
      recordSession(sessions, user)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && route(req, '/api/activities')) {
      const rawInput = await readJsonBody(req)
      const input = validateActivityInput(rawInput)
      store.logs.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        sessionId: input.sessionId,
        action: input.action,
        level: input.level,
        description: input.description,
        metadata: input.metadata,
      })
      await save()
      return json(res, 201, { ok: true })
    }

    if (req.method === 'GET' && route(req, '/api/me/activities')) {
      return json(res, 200, store.logs.filter(x => x.userId === user.id).slice(-1000).reverse())
    }

    if (url.pathname.startsWith('/api/admin/')) admin(user)

    if (req.method === 'GET' && route(req, '/api/admin/overview')) {
      const online = getOnlineUsers(sessions, 90000)
      return json(res, 200, { online, totalUsers: store.users.length, totalGroups: store.groups.length, totalLogs: store.logs.length })
    }

    if (req.method === 'GET' && route(req, '/api/admin/users')) {
      return json(res, 200, store.users)
    }

    if (req.method === 'POST' && route(req, '/api/admin/users')) {
      const rawInput = await readJsonBody(req)
      const rawEmail = typeof rawInput?.email === 'string' ? rawInput.email.trim().toLowerCase() : ''
      if (!isValidEmail(rawEmail)) return json(res, 400, { error: 'Email không hợp lệ' })
      const email = rawEmail
      const patch = normalizeUserPatch(rawInput, { groups: store.groups })
      let item = store.users.find(x => x.email === email)
      if (item) {
        assertAdminInvariant({ users: store.users, targetId: item.id, patch, actorId: user.id })
        const changedFields = []
        if (patch.role !== undefined && patch.role !== item.role) changedFields.push('role')
        if (patch.active !== undefined && patch.active !== item.active) changedFields.push('active')
        if (changedFields.length > 0) {
          store.logs.push({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            sessionId: '',
            action: 'admin.user_updated',
            level: 'security',
            description: `Admin updated user fields: ${changedFields.join(', ')}`,
            metadata: { targetUserId: item.id, changedFields },
          })
        }
        Object.assign(item, patch)
      } else {
        item = {
          id: crypto.randomUUID(),
          email,
          name: patch.name || email,
          role: patch.role || 'user',
          active: patch.active !== undefined ? patch.active : true,
          groupIds: patch.groupIds || [],
          createdAt: new Date().toISOString(),
        }
        store.users.push(item)
      }
      await save()
      return json(res, 200, item)
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/users/')) {
      const id = url.pathname.split('/').pop()
      const item = store.users.find(x => x.id === id)
      if (!item) return json(res, 404, { error: 'Not found' })
      const rawInput = await readJsonBody(req)
      const patch = normalizeUserPatch(rawInput, { groups: store.groups })
      assertAdminInvariant({ users: store.users, targetId: item.id, patch, actorId: user.id })
      const changedFields = []
      if (patch.role !== undefined && patch.role !== item.role) changedFields.push('role')
      if (patch.active !== undefined && patch.active !== item.active) changedFields.push('active')
      if (changedFields.length > 0) {
        store.logs.push({
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          sessionId: '',
          action: 'admin.user_updated',
          level: 'security',
          description: `Admin updated user fields: ${changedFields.join(', ')}`,
          metadata: { targetUserId: item.id, changedFields },
        })
      }
      Object.assign(item, patch)
      await save()
      return json(res, 200, item)
    }

    if (req.method === 'GET' && route(req, '/api/admin/groups')) {
      return json(res, 200, store.groups)
    }

    if (req.method === 'POST' && route(req, '/api/admin/groups')) {
      const input = await readJsonBody(req)
      const item = {
        id: crypto.randomUUID(),
        name: String(input.name || '').trim(),
        description: String(input.description || ''),
        createdAt: new Date().toISOString(),
      }
      if (!item.name) return json(res, 400, { error: 'Name required' })
      store.groups.push(item)
      await save()
      return json(res, 201, item)
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/admin/groups/')) {
      const id = url.pathname.split('/').pop()
      store.groups = store.groups.filter(x => x.id !== id)
      store.users.forEach(x => (x.groupIds = x.groupIds.filter(g => g !== id)))
      await save()
      return json(res, 200, { ok: true })
    }

    if (req.method === 'GET' && route(req, '/api/admin/logs')) {
      const q = (url.searchParams.get('q') || '').toLowerCase()
      const level = url.searchParams.get('level') || ''
      const email = (url.searchParams.get('email') || '').toLowerCase()
      const from = url.searchParams.get('from')
      const to = url.searchParams.get('to')
      const logs = store.logs.filter(x =>
        (!q || JSON.stringify(x).toLowerCase().includes(q)) &&
        (!level || x.level === level) &&
        (!email || x.userEmail.includes(email)) &&
        (!from || x.timestamp >= from) &&
        (!to || x.timestamp <= to)
      )
      return json(res, 200, logs.slice(-5000).reverse())
    }

    if (req.method === 'DELETE' && route(req, '/api/admin/logs')) {
      const input = await readJsonBody(req)
      const from = String(input.from || '')
      const to = String(input.to || '')
      if (!from || !to) return json(res, 400, { error: 'from and to are required' })
      const before = store.logs.length
      store.logs = store.logs.filter(x => x.timestamp < from || x.timestamp > to)
      await save()
      return json(res, 200, { deleted: before - store.logs.length })
    }

    return json(res, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    const status = error.status || 500
    const message = error.status ? (error.message || 'Error') : 'Server error'
    if (status === 413) {
      res.writeHead(413, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'close',
      })
      res.on('finish', () => {
        setImmediate(() => {
          if (req.socket && !req.socket.destroyed) {
            req.socket.destroy()
          }
        })
      })
      return res.end(JSON.stringify({ error: message }))
    }
    return json(res, status, { error: message })
  }
})

server.listen(port, '0.0.0.0', () => console.log(`API listening on ${port}`))
