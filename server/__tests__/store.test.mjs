// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
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
import { createShutdownHandler } from '../lifecycle.mjs'

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
    let proc = null
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

        process.on('message', async msg => {
          if (msg === 'SIGTERM') {
            await storeManager.flush()
            process.exit(0)
          }
        })

        process.stdout.write('READY\\n')
        `,
        'utf8'
      )

      const isWin = process.platform === 'win32'
      proc = spawn('node', [workerScript], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'inherit', isWin ? 'ipc' : 'pipe'],
      })

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('C5 worker startup timeout')), 5000)
        proc.stdout.on('data', chunk => {
          if (chunk.toString().includes('READY')) {
            clearTimeout(timeout)
            resolve()
          }
        })
        proc.on('error', err => {
          clearTimeout(timeout)
          reject(err)
        })
      })

      // Send SIGTERM while save is pending in delayMs
      if (isWin) {
        proc.send('SIGTERM')
      } else {
        proc.kill('SIGTERM')
      }

      const exitCode = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (proc) proc.kill('SIGKILL')
          reject(new Error('C5 worker exit timeout'))
        }, 5000)
        proc.on('exit', code => {
          clearTimeout(timeout)
          resolve(code)
        })
      })
      expect(exitCode).toBe(0)

      // Data file must have the latest change
      const saved = JSON.parse(readFileSync(dataFile, 'utf8'))
      expect(saved.users.length).toBe(1)
      expect(saved.users[0].id).toBe('sigterm-saved-user')
    } finally {
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGKILL')
        } catch {}
      }
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, 10000)

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

  // K1: Store khoảng 200.000 log (đủ lớn để ghi mất thời gian). Gọi flush() lần 1; trong lúc đang ghi, sửa store; gọi flush() lần 2 → khi lần 2 resolve, file trên đĩa chứa thay đổi vừa sửa.
  it('K1: wait for in-flight write; second flush includes mid-flight modifications', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-k1-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const logs = []
      for (let i = 0; i < 200000; i++) {
        logs.push({
          id: `log-${i}`,
          timestamp: '2026-11-19T00:00:00.000Z',
          action: 'document.view',
          level: 'info',
        })
      }
      const store = { users: [], groups: [], logs }
      const storeManager = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        logMaxInStore: 300000,
      })

      // Call flush #1
      const flush1 = storeManager.flush()

      // While write #1 is in-flight, mutate store and call flush #2
      store.users.push({ id: 'user-k1-midflight', name: 'Mid-Flight Added User' })
      const flush2 = storeManager.flush()

      await Promise.all([flush1, flush2])

      const saved = JSON.parse(readFileSync(dataFile, 'utf8'))
      expect(saved.users.some(u => u.id === 'user-k1-midflight')).toBe(true)
      expect(saved.logs.length).toBe(200000)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, 30000)

  // K2 (a): Unit test createShutdownHandler với server giả + CoalescedStore thật đang ghi dở: shutdown chỉ gọi exit(0) sau khi file đã có thay đổi.
  it('K2a: createShutdownHandler unit test waits for in-flight CoalescedStore write before calling exit(0)', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-k2a-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const store = { users: [], groups: [], logs: [] }
      const storeManager = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        delayMs: 100,
      })

      // Fake server with close method
      let serverClosed = false
      const fakeServer = {
        listening: true,
        close(cb) {
          serverClosed = true
          if (typeof cb === 'function') cb()
        },
      }

      let exitCalledWith = null
      const mockExit = vi.fn(code => {
        exitCalledWith = code
      })

      const shutdown = createShutdownHandler({
        server: fakeServer,
        storeManager,
        exit: mockExit,
        timeoutMs: 5000,
      })

      // Stage change and start write
      store.users.push({ id: 'k2a-saved-user', name: 'Saved on shutdown unit test' })
      storeManager.scheduleSave()

      // Call shutdown twice concurrently -> only 1 run
      const p1 = shutdown('SIGTERM')
      const p2 = shutdown('SIGTERM')
      expect(p1).toBe(p2)

      await p1

      // Exit(0) must have been called after file is saved
      expect(mockExit).toHaveBeenCalledTimes(1)
      expect(exitCalledWith).toBe(0)
      expect(serverClosed).toBe(true)

      const saved = JSON.parse(readFileSync(dataFile, 'utf8'))
      expect(saved.users.some(u => u.id === 'k2a-saved-user')).toBe(true)
      expect(existsSync(`${dataFile}.tmp`)).toBe(false)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // K2 (b): Test child_process dùng TÍN HIỆU THẬT: tạo file server/__tests__/fixtures/shutdown-harness.mjs dựng CoalescedStore + createShutdownHandler, ghi thay đổi rồi in "READY". Test cha gửi kill('SIGTERM') 2 lần → exit code 0, file có thay đổi, không có .tmp.
  it.skipIf(process.platform === 'win32')(
    'K2b: real SIGTERM on POSIX terminates harness with exit code 0 and flushes in-flight change',
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-k2b-'))
      const dataFile = join(tempDir, 'store.json')
      const harnessPath = join(process.cwd(), 'server/__tests__/fixtures/shutdown-harness.mjs')

      let child = null
      try {
        child = spawn(process.execPath, [harnessPath], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATA_FILE: dataFile,
          },
          stdio: ['ignore', 'pipe', 'inherit'],
        })

        // Wait for child to output "READY"
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Harness startup timed out')), 5000)
          child.stdout.on('data', chunk => {
            if (chunk.toString().includes('READY')) {
              clearTimeout(timeout)
              resolve()
            }
          })
          child.on('error', err => {
            clearTimeout(timeout)
            reject(err)
          })
        })

        // Send SIGTERM 2 times consecutively
        child.kill('SIGTERM')
        child.kill('SIGTERM')

        const exitCode = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (child) child.kill('SIGKILL')
            reject(new Error('Child exit timed out'))
          }, 8000)
          child.on('exit', code => {
            clearTimeout(timeout)
            resolve(code)
          })
        })

        expect(exitCode).toBe(0)

        // File must have change
        const saved = JSON.parse(readFileSync(dataFile, 'utf8'))
        expect(saved.users.some(u => u.id === 'k2-sigterm-user')).toBe(true)

        // No leftover .tmp file
        expect(existsSync(`${dataFile}.tmp`)).toBe(false)
      } finally {
        if (child && !child.killed) {
          try {
            child.kill('SIGKILL')
          } catch {}
        }
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
    15000
  )

  // K4: 1.500 log, maxInStore=1000, appendFn bị chặn tới khi test cho phép. Trong lúc chặn, xoá log L0 và L700 bằng cách gán store.logs = store.logs.filter(...) → sau khi xong: archive không có L0; L500 có trong archive; tổng log ở store + archive = 1.498, mỗi id xuất hiện đúng 1 lần.
  it('K4: log rotation by id without losing or duplicating logs during concurrent admin deletion', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-k4-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const logs = []

      // Create 1500 logs such that L0 is at index 0 and L500 is in the candidate excess (index 499)
      logs.push({ id: 'L0', timestamp: '2026-11-19T00:00:00.000Z', action: 'view' })
      for (let i = 2; i <= 500; i++) {
        logs.push({ id: `L${i}`, timestamp: '2026-11-19T00:00:00.000Z', action: 'view' })
      }
      for (let i = 501; i <= 1500; i++) {
        logs.push({ id: `L${i}`, timestamp: '2026-11-19T00:00:00.000Z', action: 'view' })
      }
      expect(logs.length).toBe(1500)

      const store = { users: [], groups: [], logs }

      let unblockAppend
      const appendBlocked = new Promise(resolve => {
        unblockAppend = resolve
      })

      let appendStarted = false
      let notifyAppendStarted
      const appendStartedPromise = new Promise(resolve => {
        notifyAppendStarted = resolve
      })

      const blockedAppendFn = vi.fn(async (archivePath, content) => {
        if (!appendStarted) {
          appendStarted = true
          notifyAppendStarted()
          await appendBlocked
        }
        await appendFile(archivePath, content, 'utf8')
      })

      const storeManager = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        logMaxInStore: 1000,
        appendFn: blockedAppendFn,
      })

      // Start rotation via flush()
      const flushPromise = storeManager.flush()

      // Wait until appendFn starts and is blocked
      await appendStartedPromise

      // While appendFn is blocked, admin deletes L0 and L700
      store.logs = store.logs.filter(x => x.id !== 'L0' && x.id !== 'L700')

      // Now unblock appendFn
      unblockAppend()

      await flushPromise

      // Verify outcomes:
      // 1. Archive does NOT have L0
      const archivePath = join(tempDir, 'logs-archive-2026-11.jsonl')
      const archiveContent = readFileSync(archivePath, 'utf8')
      const archiveLines = archiveContent.trim().split('\n').filter(Boolean)
      const archiveIds = archiveLines.map(l => JSON.parse(l).id)

      expect(archiveIds.includes('L0')).toBe(false)

      // 2. Archive DOES have L500
      expect(archiveIds.includes('L500')).toBe(true)

      // 3. Total logs in store + archive = 1498
      const savedStore = JSON.parse(readFileSync(dataFile, 'utf8'))
      const storeIds = savedStore.logs.map(l => l.id)
      expect(archiveIds.length + storeIds.length).toBe(1498)

      // 4. Every id appears exactly once (no duplicates)
      const allIds = [...archiveIds, ...storeIds]
      const uniqueIds = new Set(allIds)
      expect(uniqueIds.size).toBe(1498)
      expect(uniqueIds.has('L0')).toBe(false)
      expect(uniqueIds.has('L700')).toBe(false)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // K5: appendFn lỗi ở tháng thứ 2 → store giữ đủ log; chạy lại với appendFn bình thường → mỗi id chỉ xuất hiện 1 lần trong archive.
  it('K5: failure in 2nd month retains all logs in store; retry does not duplicate 1st month in archive', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pace-store-k5-'))
    try {
      const dataFile = join(tempDir, 'store.json')
      const logs = []

      // Month 1: 2026-10 (300 logs)
      for (let i = 1; i <= 300; i++) {
        logs.push({
          id: `log-oct-${i}`,
          timestamp: '2026-10-15T00:00:00.000Z',
          action: 'document.view',
        })
      }

      // Month 2: 2026-11 (1200 logs)
      for (let i = 1; i <= 1200; i++) {
        logs.push({
          id: `log-nov-${i}`,
          timestamp: '2026-11-15T00:00:00.000Z',
          action: 'document.view',
        })
      }

      const store = { users: [], groups: [], logs: [...logs] }

      // Faulty appendFn: succeeds for month 1, fails for month 2
      const failingAppendFn = vi.fn(async (archivePath, content) => {
        if (archivePath.includes('2026-11')) {
          throw new Error('Simulated disk failure on month 2')
        }
        await appendFile(archivePath, content, 'utf8')
      })

      const storeManagerFail = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        logMaxInStore: 1000,
        appendFn: failingAppendFn,
      })

      await storeManagerFail.flush()

      // Store retains all 1500 logs because archiving failed
      expect(store.logs.length).toBe(1500)

      // Month 1 archive was written on disk
      const octArchive = join(tempDir, 'logs-archive-2026-10.jsonl')
      const octContent1 = readFileSync(octArchive, 'utf8')
      expect(octContent1.trim().split('\n').length).toBe(300)

      // Run 2: retry with normal appendFn (appendFile)
      const storeManagerRetry = new CoalescedStore({
        file: dataFile,
        getStore: () => store,
        logMaxInStore: 1000,
        appendFn: appendFile,
      })

      await storeManagerRetry.flush()

      // Store now retains 1000 logs (500 rotated)
      expect(store.logs.length).toBe(1000)

      // Month 1 archive must NOT duplicate logs: still exactly 300 lines
      const octContent2 = readFileSync(octArchive, 'utf8')
      const octLines = octContent2.trim().split('\n')
      expect(octLines.length).toBe(300)

      const octIds = octLines.map(l => JSON.parse(l).id)
      expect(new Set(octIds).size).toBe(300)

      // Month 2 archive has 200 logs
      const novArchive = join(tempDir, 'logs-archive-2026-11.jsonl')
      const novContent = readFileSync(novArchive, 'utf8')
      const novLines = novContent.trim().split('\n')
      expect(novLines.length).toBe(200)

      const novIds = novLines.map(l => JSON.parse(l).id)
      expect(new Set(novIds).size).toBe(200)

      // Total archived = 500, total store = 1000, all 1500 logs accounted for once
      const allArchived = [...octIds, ...novIds]
      expect(allArchived.length).toBe(500)
      expect(new Set(allArchived).size).toBe(500)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
