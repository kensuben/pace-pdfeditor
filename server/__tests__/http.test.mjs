// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'node:stream'
import http from 'node:http'
import { readJsonBody, validateActivityInput, parseBodyLimit, DEFAULT_BODY_LIMIT_BYTES } from '../http.mjs'

describe('Part B: Request Body & Activity Hardening (F-8b)', () => {
  // B1: Body 300 KB → 413, đọc dừng sớm; body 10 KB hợp lệ → bình thường.
  it('B1: rejects 300 KB body with 413 Request body too large; accepts valid 10 KB body', async () => {
    // 1. 300 KB body
    const largeReq = new Readable({
      read() {
        this.push(Buffer.alloc(100 * 1024, 'a'))
        this.push(Buffer.alloc(100 * 1024, 'b'))
        this.push(Buffer.alloc(100 * 1024, 'c'))
        this.push(null)
      },
    })
    const destroySpy = vi.spyOn(largeReq, 'destroy')

    await expect(readJsonBody(largeReq, { limitBytes: 256 * 1024 })).rejects.toMatchObject({
      status: 413,
      message: 'Request body too large',
    })

    // 2. 10 KB valid body
    const validData = { text: 'x'.repeat(10 * 1024 - 20) }
    const validReq = Readable.from([Buffer.from(JSON.stringify(validData))])
    const parsed = await readJsonBody(validReq, { limitBytes: 256 * 1024 })
    expect(parsed).toEqual(validData)
  })

  // B2: Body {abc → 400 Invalid JSON body; body [1,2] → 400.
  it('B2: rejects invalid JSON syntax and non-object root with 400 Invalid JSON body', async () => {
    // 1. Syntax error
    const syntaxReq = Readable.from([Buffer.from('{abc')])
    await expect(readJsonBody(syntaxReq)).rejects.toMatchObject({
      status: 400,
      message: 'Invalid JSON body',
    })

    // 2. Non-object root (array)
    const arrayReq = Readable.from([Buffer.from('[1,2]')])
    await expect(readJsonBody(arrayReq)).rejects.toMatchObject({
      status: 400,
      message: 'Invalid JSON body',
    })

    // 3. Non-object root (primitive number or string)
    const numReq = Readable.from([Buffer.from('12345')])
    await expect(readJsonBody(numReq)).rejects.toMatchObject({
      status: 400,
      message: 'Invalid JSON body',
    })

    // 4. Empty body returns {}
    const emptyReq = Readable.from([])
    const emptyResult = await readJsonBody(emptyReq)
    expect(emptyResult).toEqual({})
  })

  // B3: metadata = { a: { b: 1 }, c: "x" } → lưu { c: "x" }; 30 key → lưu 20 key; chuỗi 1.000 ký tự → cắt còn 200.
  it('B3: sanitizes metadata: drops nested objects, caps at 20 keys, truncates strings to 200 chars', () => {
    // 1. Nested objects dropped
    const res1 = validateActivityInput({
      action: 'export.pdf',
      metadata: { a: { b: 1 }, c: 'x' },
    })
    expect(res1.metadata).toEqual({ c: 'x' })

    // 2. 30 keys capped at 20
    const manyKeys = {}
    for (let i = 0; i < 30; i++) {
      manyKeys[`key_${String(i).padStart(2, '0')}`] = i
    }
    const res2 = validateActivityInput({
      action: 'export.pdf',
      metadata: manyKeys,
    })
    expect(Object.keys(res2.metadata).length).toBe(20)

    // 3. String truncated to 200 chars
    const longString = 'a'.repeat(1000)
    const res3 = validateActivityInput({
      action: 'export.pdf',
      metadata: { note: longString },
    })
    expect(res3.metadata.note.length).toBe(200)
    expect(res3.metadata.note).toBe('a'.repeat(200))
  })

  // B4: action: "DROP TABLE" → 400; level: "critical" → lưu info.
  it('B4: rejects invalid action with 400, normalizes unknown level to info', () => {
    // 1. Invalid action with uppercase / space
    expect(() => validateActivityInput({ action: 'DROP TABLE' })).toThrowError()
    try {
      validateActivityInput({ action: 'DROP TABLE' })
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('action không hợp lệ')
    }

    // 2. Valid action patterns: [a-z0-9._-]
    const valid = validateActivityInput({ action: 'pdf.export_v2-ok' })
    expect(valid.action).toBe('pdf.export_v2-ok')

    // 3. Invalid level defaults to info
    const resLevel = validateActivityInput({ action: 'test.run', level: 'critical' })
    expect(resLevel.level).toBe('info')

    // 4. Valid levels preserved
    for (const lvl of ['info', 'success', 'warning', 'security']) {
      expect(validateActivityInput({ action: 'test.run', level: lvl }).level).toBe(lvl)
    }

    // 5. Truncates description and sessionId
    const resTrunc = validateActivityInput({
      action: 'test.run',
      description: 'd'.repeat(600),
      sessionId: 's'.repeat(150),
    })
    expect(resTrunc.description.length).toBe(500)
    expect(resTrunc.sessionId.length).toBe(100)
  })

  // B5: Lỗi không mong đợi (giả lập trong test) → 500 { "error": "Server error" }.
  it('B5: masks unexpected errors without status as 500 { error: "Server error" }', async () => {
    // Simulate server error handling pipeline
    const handler = (error, res) => {
      const status = error.status || 500
      const message = error.status ? (error.message || 'Error') : 'Server error'
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: message }))
    }

    // 1. Unexpected error with sensitive internal message
    const server = http.createServer((req, res) => {
      try {
        throw new Error('Database password failed: /secret/path')
      } catch (err) {
        handler(err, res)
      }
    })

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port

    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data).toEqual({ error: 'Server error' })
      expect(JSON.stringify(data)).not.toContain('Database password')
    } finally {
      await new Promise(resolve => server.close(resolve))
    }

    // 2. Controlled error with status preserves message
    const server2 = http.createServer((req, res) => {
      try {
        const err = new Error('Request body too large')
        err.status = 413
        throw err
      } catch (err) {
        handler(err, res)
      }
    })

    await new Promise(resolve => server2.listen(0, '127.0.0.1', resolve))
    const port2 = server2.address().port

    try {
      const response = await fetch(`http://127.0.0.1:${port2}/`)
      expect(response.status).toBe(413)
      const data = await response.json()
      expect(data).toEqual({ error: 'Request body too large' })
    } finally {
      await new Promise(resolve => server2.close(resolve))
    }
  })

  it('verifies parseBodyLimit handles defaults and warnings correctly', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseBodyLimit(undefined)).toBe(DEFAULT_BODY_LIMIT_BYTES)
    expect(parseBodyLimit('')).toBe(DEFAULT_BODY_LIMIT_BYTES)
    expect(parseBodyLimit('524288')).toBe(524288)

    expect(parseBodyLimit('-10')).toBe(DEFAULT_BODY_LIMIT_BYTES)
    expect(warnSpy).toHaveBeenCalled()

    expect(parseBodyLimit('invalid')).toBe(DEFAULT_BODY_LIMIT_BYTES)
    warnSpy.mockRestore()
  })

  // K3: HTTP server thật (http.createServer + readJsonBody): gửi body khoảng 640 KB theo từng chunk → client nhận HTTP 413 với body {"error":"Request body too large"}, không phải ECONNRESET. Body 10 KB hợp lệ vẫn 200.
  it('K3: real HTTP server returns HTTP 413 without ECONNRESET for 640 KB chunked body; 200 for 10 KB valid body', async () => {
    const server = http.createServer(async (req, res) => {
      try {
        const body = await readJsonBody(req, { limitBytes: 256 * 1024 })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, receivedBytes: JSON.stringify(body).length }))
      } catch (err) {
        const status = err.status || 500
        const message = err.status ? (err.message || 'Error') : 'Server error'
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
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: message }))
      }
    })

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port

    try {
      // 1. Send ~640 KB in chunks (10 chunks of 64 KB each)
      const chunkCount = 10
      const chunkSize = 64 * 1024
      const response = await new Promise((resolve) => {
        const clientReq = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/',
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'transfer-encoding': 'chunked',
            },
          },
          res => {
            let bodyStr = ''
            res.on('data', c => { bodyStr += c.toString('utf8') })
            res.on('end', () => {
              resolve({ statusCode: res.statusCode, body: bodyStr })
            })
          }
        )

        clientReq.on('error', () => {
          // write error after server closed socket is expected
        })

        for (let i = 0; i < chunkCount; i++) {
          try {
            clientReq.write(Buffer.alloc(chunkSize, 'a'))
          } catch {}
        }
        try {
          clientReq.end()
        } catch {}
      })

      expect(response.statusCode).toBe(413)
      expect(JSON.parse(response.body)).toEqual({ error: 'Request body too large' })

      // 2. Send 10 KB valid body -> 200 OK
      const validData = JSON.stringify({ key: 'b'.repeat(10 * 1024) })
      const validResponse = await fetch(`http://127.0.0.1:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: validData,
      })
      expect(validResponse.status).toBe(200)
      const validJson = await validResponse.json()
      expect(validJson.ok).toBe(true)
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })
})
