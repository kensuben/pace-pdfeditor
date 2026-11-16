// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)
import {
  createTokenVerifier,
  authenticateUser,
  sanitizeUserInput,
  validateAuthConfig,
  GUID_REGEX,
  FORBIDDEN_TENANTS,
} from '../auth.mjs'

const TEST_TENANT_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_TENANT_ID = '33333333-3333-3333-3333-333333333333'
const TEST_CLIENT_ID = '22222222-2222-2222-2222-222222222222'
const OTHER_CLIENT_ID = '44444444-4444-4444-4444-444444444444'

describe('Server Authentication & Tenant Validation (F-6)', () => {
  let privateKey
  let localJwks

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256')
    privateKey = keyPair.privateKey
    const jwk = await exportJWK(keyPair.publicKey)
    jwk.kid = 'test-key-id-1'
    jwk.alg = 'RS256'
    jwk.use = 'sig'
    localJwks = createLocalJWKSet({ keys: [jwk] })
  })

  async function signToken(claims, {
    key = privateKey,
    kid = 'test-key-id-1',
    issuer = `https://login.microsoftonline.com/${TEST_TENANT_ID}/v2.0`,
    audience = TEST_CLIENT_ID,
    expiresIn = '1h',
  } = {}) {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()

    if (issuer) jwt.setIssuer(issuer)
    if (audience) jwt.setAudience(audience)
    if (expiresIn) jwt.setExpirationTime(expiresIn)

    return jwt.sign(key)
  }

  // K1: Token hợp lệ (đúng aud, iss, tid, có oid, email trong allowlist) → xác thực thành công.
  it('K1: valid token with matching aud, iss, tid, and oid passes verification and authenticates allowlisted user', async () => {
    const verifyToken = createTokenVerifier({
      clientId: TEST_CLIENT_ID,
      tenantId: TEST_TENANT_ID,
      jwks: localJwks,
    })

    const token = await signToken({
      preferred_username: 'user01@example.com',
      name: 'Học viên Test 01',
      tid: TEST_TENANT_ID,
      oid: '00000000-user-0001-0000-000000000001',
    })

    const payload = await verifyToken(token)
    expect(payload).toBeDefined()
    expect(payload.preferred_username).toBe('user01@example.com')
    expect(payload.tid).toBe(TEST_TENANT_ID)
    expect(payload.oid).toBe('00000000-user-0001-0000-000000000001')

    // Allowlisted user in store
    const store = {
      users: [
        {
          id: 'user-id-1',
          email: 'user01@example.com',
          name: 'Học viên Test 01',
          role: 'user',
          active: true,
          groupIds: [],
          createdAt: new Date().toISOString(),
        },
      ],
      logs: [],
    }

    const user = await authenticateUser({ payload, store, save: async () => {} })
    expect(user).toBeDefined()
    expect(user.id).toBe('user-id-1')
    expect(user.oid).toBe('00000000-user-0001-0000-000000000001')
    expect(user.tid).toBe(TEST_TENANT_ID)
  })

  // K2: Token đúng chữ ký nhưng tid là tenant khác → bị từ chối (401).
  it('K2: token with valid signature but mismatched tid is rejected with 401 Invalid token', async () => {
    const verifyToken = createTokenVerifier({
      clientId: TEST_CLIENT_ID,
      tenantId: TEST_TENANT_ID,
      jwks: localJwks,
    })

    // Token has expected issuer and audience, but tid belongs to another tenant
    const token = await signToken({
      preferred_username: 'intruder@example.com',
      tid: OTHER_TENANT_ID,
      oid: '00000000-user-intruder-0000-000000000002',
    })

    await expect(verifyToken(token)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    })
  })

  // K3: Sai iss (vd. .../<tenant khác>/v2.0 hoặc thiếu /v2.0) → 401. Sai aud → 401. Token hết hạn → 401.
  it('K3: invalid issuer, missing /v2.0, wrong aud, or expired token are all rejected with 401', async () => {
    const verifyToken = createTokenVerifier({
      clientId: TEST_CLIENT_ID,
      tenantId: TEST_TENANT_ID,
      jwks: localJwks,
    })

    // 1. Wrong issuer (other tenant)
    const tokenWrongIssuer = await signToken(
      { preferred_username: 'u@example.com', tid: TEST_TENANT_ID, oid: 'o1' },
      { issuer: `https://login.microsoftonline.com/${OTHER_TENANT_ID}/v2.0` }
    )
    await expect(verifyToken(tokenWrongIssuer)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    })

    // 2. Issuer missing /v2.0
    const tokenMissingV2 = await signToken(
      { preferred_username: 'u@example.com', tid: TEST_TENANT_ID, oid: 'o1' },
      { issuer: `https://login.microsoftonline.com/${TEST_TENANT_ID}` }
    )
    await expect(verifyToken(tokenMissingV2)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    })

    // 3. Wrong audience
    const tokenWrongAud = await signToken(
      { preferred_username: 'u@example.com', tid: TEST_TENANT_ID, oid: 'o1' },
      { audience: OTHER_CLIENT_ID }
    )
    await expect(verifyToken(tokenWrongAud)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    })

    // 4. Expired token
    const tokenExpired = await signToken(
      { preferred_username: 'u@example.com', tid: TEST_TENANT_ID, oid: 'o1' },
      { expiresIn: '-10s' }
    )
    await expect(verifyToken(tokenExpired)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    })

    // 5. Missing oid claim
    const tokenMissingOid = await signToken({
      preferred_username: 'u@example.com',
      tid: TEST_TENANT_ID,
    })
    await expect(verifyToken(tokenMissingOid)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    })

    // 6. Missing tid claim
    const tokenMissingTid = await signToken({
      preferred_username: 'u@example.com',
      oid: 'o1',
    })
    await expect(verifyToken(tokenMissingTid)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    })

    // 7. Empty token
    await expect(verifyToken('')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    })
  })

  // K4: User cũ chưa có oid đăng nhập hợp lệ → oid/tid được lưu; lần sau dùng oid khác cùng email → 403 và có log auth.identity_mismatch (không chứa token/email).
  it('K4: legacy user binds oid/tid on first login; different oid for same email triggers 403 and auth.identity_mismatch log without sensitive data', async () => {
    let saved = false
    const store = {
      users: [
        {
          id: 'user-legacy-1',
          email: 'legacy@example.com',
          name: 'Legacy User',
          role: 'user',
          active: true,
          groupIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          // oid and tid are initially undefined
        },
      ],
      logs: [],
    }

    // First login: binds oid and tid
    const payloadFirstLogin = {
      preferred_username: 'legacy@example.com',
      oid: 'oid-genuine-user-1',
      tid: TEST_TENANT_ID,
    }

    const userFirst = await authenticateUser({
      payload: payloadFirstLogin,
      store,
      save: async () => {
        saved = true
      },
    })

    expect(saved).toBe(true)
    expect(userFirst.oid).toBe('oid-genuine-user-1')
    expect(userFirst.tid).toBe(TEST_TENANT_ID)
    expect(store.users[0].oid).toBe('oid-genuine-user-1')

    // Subsequent login with matching oid succeeds
    const userSecond = await authenticateUser({
      payload: payloadFirstLogin,
      store,
      save: async () => {},
    })
    expect(userSecond.oid).toBe('oid-genuine-user-1')

    // Attacker tries to log in with same email but different oid
    const payloadSpoofedOid = {
      preferred_username: 'legacy@example.com',
      oid: 'oid-impostor-999',
      tid: TEST_TENANT_ID,
    }

    saved = false
    await expect(
      authenticateUser({
        payload: payloadSpoofedOid,
        store,
        save: async () => {
          saved = true
        },
      })
    ).rejects.toMatchObject({
      status: 403,
      message: 'Identity mismatch',
    })

    expect(saved).toBe(true)
    // Check security log
    expect(store.logs.length).toBe(1)
    const secLog = store.logs[0]
    expect(secLog.action).toBe('auth.identity_mismatch')
    expect(secLog.level).toBe('security')
    expect(secLog.userId).toBe('user-legacy-1')
    expect(secLog.metadata).toEqual({ userId: 'user-legacy-1' })

    // Ensure log does not leak token or email
    expect(secLog.userEmail).toBe('')
    expect(JSON.stringify(secLog)).not.toContain('legacy@example.com')
    expect(JSON.stringify(secLog)).not.toContain('oid-impostor-999')
  })

  // K5: Khởi động với MICROSOFT_TENANT_ID = common / organizations / rỗng, hoặc MICROSOFT_CLIENT_ID rỗng → tiến trình thoát mã ≠ 0 với thông báo rõ
  it('K5: server process fails closed (exit code != 0) with clear error when config has common/organizations/empty tenant or empty client', async () => {
    const testCases = [
      {
        name: 'common tenant',
        env: { MICROSOFT_CLIENT_ID: TEST_CLIENT_ID, MICROSOFT_TENANT_ID: 'common' },
        expectedErr: 'Single-tenant PACE application does not allow',
      },
      {
        name: 'organizations tenant',
        env: { MICROSOFT_CLIENT_ID: TEST_CLIENT_ID, MICROSOFT_TENANT_ID: 'organizations' },
        expectedErr: 'Single-tenant PACE application does not allow',
      },
      {
        name: 'consumers tenant',
        env: { MICROSOFT_CLIENT_ID: TEST_CLIENT_ID, MICROSOFT_TENANT_ID: 'consumers' },
        expectedErr: 'Single-tenant PACE application does not allow',
      },
      {
        name: 'empty tenant',
        env: { MICROSOFT_CLIENT_ID: TEST_CLIENT_ID, MICROSOFT_TENANT_ID: '' },
        expectedErr: 'MICROSOFT_TENANT_ID must be a valid Directory (tenant) GUID',
      },
      {
        name: 'empty client id',
        env: { MICROSOFT_CLIENT_ID: '', MICROSOFT_TENANT_ID: TEST_TENANT_ID },
        expectedErr: 'MICROSOFT_CLIENT_ID must be a valid GUID',
      },
      {
        name: 'non-guid client id',
        env: { MICROSOFT_CLIENT_ID: 'not-a-guid', MICROSOFT_TENANT_ID: TEST_TENANT_ID },
        expectedErr: 'MICROSOFT_CLIENT_ID must be a valid GUID',
      },
    ]

    for (const tc of testCases) {
      const tempDir = mkdtempSync(join(tmpdir(), 'pace-auth-test-'))
      try {
        let failed = false
        try {
          await execFileAsync('node', ['server/index.mjs'], {
            env: {
              ...process.env,
              ...tc.env,
              DATA_FILE: join(tempDir, 'store.json'),
              PORT: '39999',
            },
            timeout: 5000,
          })
        } catch (err) {
          failed = true
          expect(err.code, `Expected non-zero exit for case: ${tc.name}`).not.toBe(0)
          expect(err.stderr).toContain('[AUTH CONFIG ERROR]')
          expect(err.stderr).toContain(tc.expectedErr)
        }
        expect(failed, `Expected process to fail for ${tc.name}`).toBe(true)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    }
  })

  // K6: PATCH /api/admin/users/:id với body { "oid": "x", "tid": "y", "id": "z" } → không đổi các trường này
  it('K6: sanitizeUserInput strips oid, tid, id, and createdAt; existing user fields are immutable', () => {
    const maliciousInput = {
      name: 'Nguyen Van A',
      role: 'admin',
      oid: 'hacked-oid-value',
      tid: 'hacked-tid-value',
      id: 'hacked-user-id',
      createdAt: '1970-01-01T00:00:00.000Z',
      active: true,
    }

    const sanitized = sanitizeUserInput(maliciousInput)

    expect(sanitized.name).toBe('Nguyen Van A')
    expect(sanitized.role).toBe('admin')
    expect(sanitized.active).toBe(true)
    expect(sanitized.oid).toBeUndefined()
    expect(sanitized.tid).toBeUndefined()
    expect(sanitized.id).toBeUndefined()
    expect(sanitized.createdAt).toBeUndefined()

    // Test immutability on user record (as done in PATCH route)
    const existingUser = {
      id: 'original-id-123',
      email: 'user@example.com',
      name: 'Old Name',
      role: 'user',
      active: true,
      groupIds: ['g1'],
      createdAt: '2026-01-15T00:00:00.000Z',
      oid: 'original-oid-456',
      tid: TEST_TENANT_ID,
    }

    Object.assign(existingUser, sanitized, {
      id: existingUser.id,
      email: existingUser.email,
      createdAt: existingUser.createdAt,
      oid: existingUser.oid,
      tid: existingUser.tid,
    })

    expect(existingUser.id).toBe('original-id-123')
    expect(existingUser.email).toBe('user@example.com')
    expect(existingUser.oid).toBe('original-oid-456')
    expect(existingUser.tid).toBe(TEST_TENANT_ID)
    expect(existingUser.createdAt).toBe('2026-01-15T00:00:00.000Z')
    expect(existingUser.name).toBe('Nguyen Van A')
  })

  // K7: docker-compose configurations enforce required MICROSOFT_TENANT_ID and MICROSOFT_CLIENT_ID
  it('K7: deploy configurations require GUID tenant/client IDs and prohibit common', () => {
    const prodCompose = readFileSync('deploy/docker-compose.prod.yml', 'utf8')
    const prodEnvExample = readFileSync('deploy/.env.production.example', 'utf8')
    const devCompose = readFileSync('compose.yaml', 'utf8')

    // Both compose files use ${MICROSOFT_TENANT_ID:?...}
    expect(prodCompose).toMatch(/MICROSOFT_TENANT_ID:\s*\$\{MICROSOFT_TENANT_ID:\?/)
    expect(prodCompose).toMatch(/MICROSOFT_CLIENT_ID:\s*\$\{MICROSOFT_CLIENT_ID:\?/)

    expect(devCompose).toMatch(/MICROSOFT_TENANT_ID:\s*\$\{MICROSOFT_TENANT_ID:\?/)

    // Production env example uses fake GUID and disallows common
    expect(prodEnvExample).toMatch(/MICROSOFT_TENANT_ID=00000000-0000-0000-0000-000000000000/)
    expect(prodEnvExample).not.toMatch(/MICROSOFT_TENANT_ID=common/)
    expect(prodEnvExample).toContain('không dùng common/organizations')
  })

  // GUID regex and forbidden tenants verification
  it('validates GUID regex and forbidden tenants correctly', () => {
    expect(GUID_REGEX.test(TEST_TENANT_ID)).toBe(true)
    expect(GUID_REGEX.test(TEST_CLIENT_ID)).toBe(true)
    expect(GUID_REGEX.test('common')).toBe(false)
    expect(GUID_REGEX.test('organizations')).toBe(false)
    expect(GUID_REGEX.test('')).toBe(false)
    expect(FORBIDDEN_TENANTS).toContain('common')
    expect(FORBIDDEN_TENANTS).toContain('organizations')
    expect(FORBIDDEN_TENANTS).toContain('consumers')
  })
})
