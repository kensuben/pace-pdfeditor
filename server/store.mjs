import { appendFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const DEFAULT_LOG_MAX_IN_STORE = 20000

export function parseLogMaxInStore(val = process.env.LOG_MAX_IN_STORE) {
  if (val === undefined || val === '') return DEFAULT_LOG_MAX_IN_STORE
  const parsed = Number(val)
  if (Number.isInteger(parsed) && parsed >= 1000) return parsed
  console.warn(`[STORE CONFIG WARNING] Invalid LOG_MAX_IN_STORE: "${val}". Using default ${DEFAULT_LOG_MAX_IN_STORE}.`)
  return DEFAULT_LOG_MAX_IN_STORE
}

export function recordSession(sessions, user) {
  sessions.set(user.id, {
    email: user.email,
    name: user.name,
    lastSeen: new Date().toISOString(),
  })
}

export function getOnlineUsers(sessions, cutoffMs = 90000) {
  const cutoff = Date.now() - cutoffMs
  const online = []
  for (const session of sessions.values()) {
    if (Date.parse(session.lastSeen) >= cutoff) {
      online.push(session)
    }
  }
  return online
}

export function cleanStaleSessions(sessions, maxAgeMs = 10 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs
  for (const [id, session] of sessions.entries()) {
    if (Date.parse(session.lastSeen) < cutoff) {
      sessions.delete(id)
    }
  }
}

export async function rotateLogs(store, { dataDir, maxInStore = parseLogMaxInStore(), appendFn = appendFile } = {}) {
  if (!store || !Array.isArray(store.logs) || store.logs.length <= maxInStore) {
    return { rotated: 0 }
  }

  const excess = store.logs.length - maxInStore
  const toArchive = store.logs.slice(0, excess)

  // Group by year-month
  const byMonth = new Map()
  for (const log of toArchive) {
    const d = new Date(log.timestamp)
    const yyyy = Number.isNaN(d.getTime()) ? 'unknown' : d.getUTCFullYear()
    const mm = Number.isNaN(d.getTime()) ? 'unknown' : String(d.getUTCMonth() + 1).padStart(2, '0')
    const key = `${yyyy}-${mm}`
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key).push(log)
  }

  // Attempt to write all archive files
  try {
    for (const [month, logs] of byMonth.entries()) {
      const content = logs.map(l => JSON.stringify(l)).join('\n') + '\n'
      const archivePath = join(dataDir, `logs-archive-${month}.jsonl`)
      await appendFn(archivePath, content, 'utf8')
    }
    // Only remove from store after archive write succeeds
    store.logs.splice(0, excess)
    return { rotated: excess }
  } catch (err) {
    console.error('[STORE ERROR] Failed to archive logs to disk:', err.message)
    // Do NOT remove logs from store on error
    throw err
  }
}

export class CoalescedStore {
  constructor({ file, getStore, delayMs = 500, logMaxInStore = parseLogMaxInStore(), appendFn = appendFile } = {}) {
    this.file = file
    this.dataDir = dirname(file)
    this.getStore = getStore
    this.delayMs = delayMs
    this.logMaxInStore = logMaxInStore
    this.appendFn = appendFn

    this.timer = null
    this.pendingResolvers = []
    this.isWriting = false
    this.hasPendingRequestDuringWrite = false
  }

  scheduleSave() {
    return new Promise((resolve, reject) => {
      this.pendingResolvers.push({ resolve, reject })
      if (this.isWriting) {
        this.hasPendingRequestDuringWrite = true
        return
      }
      if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.delayMs)
      }
    })
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.isWriting) {
      this.hasPendingRequestDuringWrite = true
      return
    }

    const resolvers = this.pendingResolvers
    this.pendingResolvers = []
    this.hasPendingRequestDuringWrite = false
    this.isWriting = true

    try {
      const store = this.getStore()

      // Log rotation before save
      try {
        await rotateLogs(store, {
          dataDir: this.dataDir,
          maxInStore: this.logMaxInStore,
          appendFn: this.appendFn,
        })
      } catch {
        // rotation error is logged, store retains logs, continue writing store.json
      }

      // Write store.json without sessions
      const toSave = {
        users: store.users || [],
        groups: store.groups || [],
        logs: store.logs || [],
      }
      await mkdir(this.dataDir, { recursive: true })
      const temp = `${this.file}.tmp`
      await writeFile(temp, JSON.stringify(toSave), 'utf8')
      await rename(temp, this.file)

      for (const r of resolvers) r.resolve()
    } catch (err) {
      console.error('[STORE ERROR] Coalesced write failed:', err)
      for (const r of resolvers) r.reject(err)
    } finally {
      this.isWriting = false
      if (this.hasPendingRequestDuringWrite || this.pendingResolvers.length > 0) {
        this.hasPendingRequestDuringWrite = false
        if (!this.timer) {
          this.timer = setTimeout(() => this.flush(), this.delayMs)
        }
      }
    }
  }
}
