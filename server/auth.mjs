import { jwtVerify } from 'jose'

export const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const FORBIDDEN_TENANTS = ['common', 'organizations', 'consumers']

export function validateAuthConfig({ clientId, tenantId }) {
  const cleanClientId = String(clientId || '').trim()
  const cleanTenantId = String(tenantId || '').trim()

  if (!cleanClientId || !GUID_REGEX.test(cleanClientId)) {
    const preview = cleanClientId ? `${cleanClientId.slice(0, 8)}...` : '(empty)'
    console.error(`[AUTH CONFIG ERROR] MICROSOFT_CLIENT_ID must be a valid GUID. Got: ${preview}`)
    process.exit(1)
  }

  if (FORBIDDEN_TENANTS.includes(cleanTenantId.toLowerCase())) {
    console.error(`[AUTH CONFIG ERROR] Single-tenant PACE application does not allow '${cleanTenantId}'. MICROSOFT_TENANT_ID must be a valid Directory (tenant) GUID.`)
    process.exit(1)
  }

  if (!cleanTenantId || !GUID_REGEX.test(cleanTenantId)) {
    const preview = cleanTenantId ? `${cleanTenantId.slice(0, 8)}...` : '(empty)'
    console.error(`[AUTH CONFIG ERROR] MICROSOFT_TENANT_ID must be a valid Directory (tenant) GUID. Got: ${preview}`)
    process.exit(1)
  }

  return { clientId: cleanClientId, tenantId: cleanTenantId }
}

// TODO(verify): Microsoft Entra ID token v2.0 issuer format is https://login.microsoftonline.com/{tenantId}/v2.0
// Reference: Microsoft identity platform ID token claims reference (https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)
// and Validate tokens (https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens#validating-tokens)
export function createTokenVerifier({ clientId, tenantId, jwks }) {
  const expectedIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`

  return async function verifyToken(token) {
    if (!token) {
      const err = new Error('Invalid token')
      err.status = 401
      throw err
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        audience: clientId,
        issuer: expectedIssuer,
        algorithms: ['RS256'],
      })

      if (!payload.oid || !payload.tid) {
        throw new Error('Missing oid or tid claim')
      }

      if (String(payload.tid).toLowerCase() !== String(tenantId).toLowerCase()) {
        throw new Error('Tenant ID mismatch')
      }

      return payload
    } catch (err) {
      console.error('[AUTH ERROR] Token verification failed:', err.message)
      const error = new Error('Invalid token')
      error.status = 401
      throw error
    }
  }
}

export function sanitizeUserInput(input) {
  if (!input || typeof input !== 'object') return {}
  const { id, createdAt, oid, tid, ...rest } = input
  return rest
}

export async function authenticateUser({ payload, store, bootstrapAdmins = [], save }) {
  const email = String(payload.preferred_username || payload.email || '').toLowerCase()
  if (!email) {
    throw Object.assign(new Error('Email claim missing'), { status: 403 })
  }

  const tokenOid = String(payload.oid)
  const tokenTid = String(payload.tid)

  let user = store.users.find(x => x.email === email)
  if (!user && bootstrapAdmins.includes(email)) {
    user = {
      id: crypto.randomUUID(),
      email,
      name: String(payload.name || email),
      role: 'admin',
      active: true,
      groupIds: [],
      createdAt: new Date().toISOString(),
      oid: tokenOid,
      tid: tokenTid,
    }
    store.users.push(user)
    if (save) await save()
  }

  if (!user || !user.active) {
    throw Object.assign(new Error('Account is not authorized'), { status: 403 })
  }

  // OID binding check
  if (user.oid) {
    if (user.oid !== tokenOid) {
      store.logs.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        userId: user.id,
        userEmail: '',
        userName: '',
        sessionId: '',
        action: 'auth.identity_mismatch',
        level: 'security',
        description: 'Account oid mismatch',
        metadata: { userId: user.id },
      })
      if (save) await save()
      throw Object.assign(new Error('Identity mismatch'), { status: 403 })
    }
  } else {
    // Legacy user or admin pre-created user without oid -> bind on first successful login
    user.oid = tokenOid
    user.tid = tokenTid
    if (save) await save()
  }

  return user
}
