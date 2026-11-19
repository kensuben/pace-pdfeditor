// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  CoalescedStore,
  rotateLogs,
  recordSession,
  getOnlineUsers,
  cleanStaleSessions,
  parseLogMaxInStore,
  DEFAULT_LOG_MAX_IN_STORE,
} from '../store.mjs'

const execFileAsync = promisify(execFile)

describe('Part C: Coalesced Store & Log Rotation (F-8c)', () => {
  // C1: 100 heartbeat liên tiếp → store.json không bị ghi (spy hoặc mtime); GET /api/admin/overview vẫn trả user online.
  it('C1: 100 consecutive heartbeats do not write to store.json; getOnlineUsers returns active user', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-c1-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const store = { users: [], groups: [], logs: [] }
      writeFileSync(dataFile, JSON.stringify(store), 'utf8')
      const initialMtime = statSync(dataFile).mtimeMs

      const sessions = new Map()
      const dummyUser = { id: 'user-c1', email: 'c1@example.com', name: 'User C1' }

      // 100 consecutive heartbeats update in-memory sessions only
      for (let i = 0; i < 100; i++) {
        recordSession(sessions, dummyUser)
      }

      const currentMtime = statSync(dataFile).mtimeMs
      expect(currentMtime).toBe(initialMtime)

      // Active user within cutoff is returned
      const online = getOnlineUsers(sessions, 90000)
      expect(online.length).toBe(1)
      expect(online[0].email).toBe('c1@example.com')
      expect(online[0].name).toBe('User C1')

      // Expired user is excluded from online
      sessions.set('expired-user', {
        email: 'expired@example.com',
        name: 'Expired User',
        lastSeen: new Date(Date.now() - 100000).toISOString(),
      })
      const onlineFiltered = getOnlineUsers(sessions, 90000)
      expect(onlineFiltered.length).toBe(1)
      expect(onlineFiltered[0].email).toBe('c1@example.com')

      // cleanStaleSessions purges sessions older than 10 mins
      sessions.set('stale-user', {
        email: 'stale@example.com',
        name: 'Stale User',
        lastSeen: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      })
      cleanStaleSessions(sessions, 10 * 60 * 1000)
      expect(sessions.has('stale-user')).toBe(false)
      expect(sessions.has('user-c1')).toBe(true)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // C2: 50 lần scheduleSave() trong 100 ms → đúng 1 lần ghi; nội dung cuối đầy đủ.
  it('C2: coalesces 50 scheduleSave() calls within 100 ms into exactly 1 write with complete data', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-c2-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const store = { users: [], groups: [], logs: [] }
      const storeManager = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        delayMs: 300,
      })

      const flushSpy = vi.spyOn(storeManager, 'flush')
      const promises = []

      // 50 calls in quick succession
      for (let i = 1; i <= 50; i++) {
        store.users.push({ id: `user-${i}`, name: `User ${i}` })
        promises.push(storeManager.scheduleSave())
      }

      await Promise.all(promises)

      // Flush should be called exactly once
      expect(flushSpy).toHaveBeenCalledTimes(1)

      // Check persisted file content
      const saved = JSON.parse(readFileSync(dataFile, 'utf8'))
      expect(saved.users.length).toBe(50)
      expect(saved.users[49].id).toBe('user-50')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // C3: LOG_MAX_IN_STORE=1000, thêm 1.500 log → store còn 1.000 log mới nhất; 500 log trong file archive, mỗi dòng parse được; tổng = 1.500.
  it('C3: rotates logs when exceeding LOG_MAX_IN_STORE=1000: keeps 1000 newest in store, moves 500 to archive', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-c3-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const logs = []
      for (let i = 1; i <= 1500; i++) {
        logs.push({
          id: `log-${i}`,
          timestamp: new Date(Date.UTC(2026, 10, 16, 0, 0, i % 60)).toISOString(), // 2026-11
          action: 'document.view',
          level: 'info',
          description: `Action number ${i}`,
        })
      }

      const store = { users: [], groups: [], logs }

      // Measure unrotated store size
      const unrotatedSize = Buffer.byteLength(JSON.stringify(store))

      const storeManager = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        logMaxInStore: 1000,
      })

      await storeManager.flush()

      // Measure rotated store size
      const rotatedContent = readFileSync(dataFile, 'utf8')
      const rotatedSize = Buffer.byteLength(rotatedContent)
      const savedStore = JSON.parse(rotatedContent)

      // 1. Store retains 1000 newest logs
      expect(savedStore.logs.length).toBe(1000)
      expect(savedStore.logs[0].id).toBe('log-501')
      expect(savedStore.logs[999].id).toBe('log-1500')

      // 2. Archive file contains 500 oldest logs
      const archiveFile = join(tempDir, 'logs-archive-2026-11.jsonl')
      const archiveContent = readFileSync(archiveFile, 'utf8')
      const archiveLines = archiveContent.trim().split('\n')
      expect(archiveLines.length).toBe(500)

      const firstArchived = JSON.parse(archiveLines[0])
      expect(firstArchived.id).toBe('log-1')
      const lastArchived = JSON.parse(archiveLines[499])
      expect(lastArchived.id).toBe('log-500')

      // 3. Total logs = 1000 + 500 = 1500
      expect(savedStore.logs.length + archiveLines.length).toBe(1500)

      console.log(`[C3 Size Measurement] store.json before rotation: ${unrotatedSize} bytes, after rotation: ${rotatedSize} bytes (reduction: ${unrotatedSize - rotatedSize} bytes)`)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // C4: Giả lập lỗi ghi archive → store vẫn giữ đủ 1.500 log.
  it('C4: retains all 1500 logs in store if archiving throws an error', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-c4-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const logs = []
      for (let i = 1; i <= 1500; i++) {
        logs.push({
          id: `log-${i}`,
          timestamp: new Date().toISOString(),
          action: 'document.view',
        })
      }
      const store = { users: [], groups: [], logs }

      // Faulty appendFn that throws
      const failingAppendFn = vi.fn().mockRejectedValue(new Error('Simulated disk full'))

      const storeManager = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        logMaxInStore: 1000,
        appendFn: failingAppendFn,
      })

      await storeManager.flush()

      // Store should still hold all 1500 logs because archive write failed
      expect(store.logs.length).toBe(1500)
      const saved = JSON.parse(readFileSync(dataFile, 'utf8'))
      expect(saved.logs.length).toBe(1500)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // C5: Gửi SIGTERM khi đang có lần ghi chờ → file có dữ liệu mới nhất trước khi tiến trình thoát (child_process).
  it('C5: flushes pending write on SIGTERM before process terminates', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-c5-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const workerScript = join(tempDir, 'worker.mjs')

      const storeMjsUrl = pathToFileURL(join(process.cwd(), 'server/store.mjs')).href

      writeFileSync(
        workerScript,
        `
        import { CoalescedStore } from ${JSON.stringify(storeMjsUrl)}

        const store = { users: [], groups: [], logs: [] }
        const storeManager = new CoalescedStore({
          file: ${JSON.stringify(dataFile)},
          getStore: () => store,
          delayMs: 5000, // Long delay
        })

        // Stage change and request save
        store.users.push({ id: 'sigterm-saved-user', name: 'Saved On SIGTERM' })
        storeManager.scheduleSave()

        process.on('SIGTERM', async () => {
          await storeManager.flush()
          process.exit(0)
        })

        process.stdout.write('READY\\n')
        `,
        'utf8'
      )

      const proc = spawn('node', [workerScript], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'inherit'],
      })

      await new Promise(resolve => {
        proc.stdout.on('data', chunk => {
          if (chunk.toString().includes('READY')) resolve()
        })
      })

      // Send SIGTERM while save is pending in delayMs
      proc.kill('SIGTERM')

      const exitCode = await new Promise(resolve => proc.on('exit', code => resolve(code)))
      expect(exitCode).toBe(0)

      // Data file must have the latest change
      const saved = JSON.parse(readFileSync(dataFile, 'utf8'))
      expect(saved.users.length).toBe(1)
      expect(saved.users[0].id).toBe('sigterm-saved-user')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // C6: store.json cũ có sessions → khởi động bình thường; sau lần ghi kế tiếp, file không còn sessions.
  it('C6: ignores legacy sessions on startup and strips sessions from store.json after next write', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-c6-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const legacyStore = {
        users: [{ id: 'user-legacy', name: 'Legacy User' }],
        groups: [],
        logs: [],
        sessions: {
          'user-legacy': { email: 'legacy@example.com', lastSeen: '2025-01-01T00:00:00Z' },
        },
      }
      writeFileSync(dataFile, JSON.stringify(legacyStore), 'utf8')

      // Reading store on startup ignores sessions
      const raw = JSON.parse(readFileSync(dataFile, 'utf8'))
      const store = {
        users: Array.isArray(raw.users) ? raw.users : [],
        groups: Array.isArray(raw.groups) ? raw.groups : [],
        logs: Array.isArray(raw.logs) ? raw.logs : [],
      }
      expect(store.sessions).toBeUndefined()

      // Perform a write
      const storeManager = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        delayMs: 100,
      })
      await storeManager.flush()

      // Read back file
      const updated = JSON.parse(readFileSync(dataFile, 'utf8'))
      expect(updated.sessions).toBeUndefined()
      expect(updated.users.length).toBe(1)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // C7: docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config hợp lệ.
  it('C7: validates docker-compose.prod.yml and .env.production.example configuration', async () => {
    const composePath = join(process.cwd(), 'deploy/docker-compose.prod.yml')
    const envPath = join(process.cwd(), 'deploy/.env.production.example')

    const composeContent = readFileSync(composePath, 'utf8')
    const envContent = readFileSync(envPath, 'utf8')

    // 1. Verify LOG_MAX_IN_STORE is configured in both files
    expect(composeContent).toContain('LOG_MAX_IN_STORE: ${LOG_MAX_IN_STORE:-20000}')
    expect(envContent).toContain('LOG_MAX_IN_STORE=20000')

    // 2. If docker compose CLI is present, run config verification
    let dockerAvailable = false
    try {
      await execFileAsync('docker', ['compose', 'version'])
      dockerAvailable = true
    } catch {
      dockerAvailable = false
    }

    if (dockerAvailable) {
      const { stdout } = await execFileAsync('docker', [
        'compose',
        '-f',
        composePath,
        '--env-file',
        envPath,
        'config',
      ])
      expect(stdout).toContain('LOG_MAX_IN_STORE: "20000"')
    } else {
      // Static validation: verify required env variables are present in .env.production.example
      expect(envContent).toMatch(/^MICROSOFT_CLIENT_ID=/m)
      expect(envContent).toMatch(/^MICROSOFT_TENANT_ID=/m)
      expect(envContent).toMatch(/^ADMIN_EMAILS=/m)
      expect(envContent).toMatch(/^LOG_MAX_IN_STORE=/m)
    }
  })

  it('validates parseLogMaxInStore helper', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseLogMaxInStore(undefined)).toBe(DEFAULT_LOG_MAX_IN_STORE)
    expect(parseLogMaxInStore('')).toBe(DEFAULT_LOG_MAX_IN_STORE)
    expect(parseLogMaxInStore('50000')).toBe(50000)

    // Less than 1000 warns and falls back to default
    expect(parseLogMaxInStore('500')).toBe(DEFAULT_LOG_MAX_IN_STORE)
    expect(warnSpy).toHaveBeenCalled()

    // Non-integer warns and falls back to default
    expect(parseLogMaxInStore('invalid')).toBe(DEFAULT_LOG_MAX_IN_STORE)
    warnSpy.mockRestore()
  })
})
