import { appendFile, writeFile, rename, mkdir, readFile } from 'node:fs/promises'
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

async function getExistingArchiveIds(archivePath) {
  try {
    const content = await readFile(archivePath, 'utf8')
    const ids = new Set()
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const item = JSON.parse(trimmed)
        if (item && item.id) ids.add(item.id)
      } catch {}
    }
    return ids
  } catch {
    return new Set()
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

  // Attempt to write archive files
  const successfullyArchivedLogs = []
  try {
    for (const [month, candidateLogs] of byMonth.entries()) {
      const archivePath = join(dataDir, `logs-archive-${month}.jsonl`)
      const existingIds = await getExistingArchiveIds(archivePath)

      // Before writing, filter candidate logs:
      // 1. Must still be in store.logs (not deleted by admin)
      // 2. Must not already exist in archive file (deduplication from previous partial failure)
      const currentStoreIdsBefore = new Set(store.logs.map(l => l.id))
      const toWrite = candidateLogs.filter(l => currentStoreIdsBefore.has(l.id) && !existingIds.has(l.id))

      if (toWrite.length > 0) {
        const content = toWrite.map(l => JSON.stringify(l)).join('\n') + '\n'
        await appendFn(archivePath, content, 'utf8')
      }

      for (const log of candidateLogs) {
        if (existingIds.has(log.id) || toWrite.some(w => w.id === log.id)) {
          successfullyArchivedLogs.push(log)
        }
      }
    }

    // Check if any log was deleted from store.logs by admin during the in-flight write
    const currentStoreIdsAfter = new Set(store.logs.map(l => l.id))
    const deletedByAdmin = successfullyArchivedLogs.filter(l => !currentStoreIdsAfter.has(l.id))

    if (deletedByAdmin.length > 0) {
      const deletedSet = new Set(deletedByAdmin.map(l => l.id))
      for (const month of byMonth.keys()) {
        const archivePath = join(dataDir, `logs-archive-${month}.jsonl`)
        try {
          const content = await readFile(archivePath, 'utf8')
          const filteredLines = content.split('\n').filter(line => {
            const trimmed = line.trim()
            if (!trimmed) return false
            try {
              const item = JSON.parse(trimmed)
              return !deletedSet.has(item.id)
            } catch {
              return true
            }
          })
          await writeFile(archivePath, filteredLines.length > 0 ? filteredLines.join('\n') + '\n' : '', 'utf8')
        } catch {}
      }
    }

    // Only remove from store.logs the IDs that were archived and NOT deleted by admin
    const archivedIdsToRemove = new Set(
      successfullyArchivedLogs
        .filter(l => currentStoreIdsAfter.has(l.id))
        .map(l => l.id)
    )

    store.logs = store.logs.filter(l => !archivedIdsToRemove.has(l.id))

    return { rotated: archivedIdsToRemove.size }
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
    this.requestedSaveVersion = 0
    this.completedSaveVersion = 0
    this.currentWrite = null
  }

  scheduleSave() {
    this.requestedSaveVersion++
    const targetVersion = this.requestedSaveVersion

    return new Promise((resolve, reject) => {
      this.pendingResolvers.push({ resolve, reject, targetVersion })
      if (this.isWriting) {
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

    this.requestedSaveVersion++
    const targetVersion = this.requestedSaveVersion

    const waiter = new Promise((resolve, reject) => {
      this.pendingResolvers.push({ resolve, reject, targetVersion })
    })

    this._triggerWrite()

    return waiter
  }

  _triggerWrite() {
    if (this.currentWrite) {
      return this.currentWrite
    }

    this.isWriting = true
    this.currentWrite = (async () => {
      while (this.requestedSaveVersion > this.completedSaveVersion) {
        const versionBeingWritten = this.requestedSaveVersion
        let writeError = null

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

          this.completedSaveVersion = versionBeingWritten
        } catch (err) {
          console.error('[STORE ERROR] Coalesced write failed:', err)
          writeError = err
        }

        const remaining = []
        for (const r of this.pendingResolvers) {
          if (r.targetVersion <= versionBeingWritten) {
            if (writeError) {
              r.reject(writeError)
            } else {
              r.resolve()
            }
          } else {
            remaining.push(r)
          }
        }
        this.pendingResolvers = remaining

        if (writeError) {
          this.completedSaveVersion = versionBeingWritten
          break
        }
      }
    })().finally(() => {
      this.isWriting = false
      this.currentWrite = null
      if (this.requestedSaveVersion > this.completedSaveVersion) {
        this._triggerWrite()
      }
    })

    return this.currentWrite
  }
}
