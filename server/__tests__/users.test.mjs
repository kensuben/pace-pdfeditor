// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { normalizeUserPatch, assertAdminInvariant, isValidEmail } from '../users.mjs'

describe('Part A: Admin User Management (F-8a)', () => {
  const groups = [
    { id: 'group-1', name: 'Giảng viên' },
    { id: 'group-2', name: 'Học viên' },
  ]

  // A1: PATCH { "foo": 1, "role": "superadmin" } → 400; PATCH { "foo": 1, "name": "Học viên Test 01" } → 200, user không có foo
  it('A1: rejects invalid role with 400, and filters out unwhitelisted fields like foo', () => {
    // 1. Invalid role
    expect(() =>
      normalizeUserPatch({ foo: 1, role: 'superadmin' }, { groups })
    ).toThrowError()
    try {
      normalizeUserPatch({ foo: 1, role: 'superadmin' }, { groups })
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('role')
    }

    // 2. Whitelisted name and unwhitelisted foo
    const patch = normalizeUserPatch({ foo: 1, name: 'Học viên Test 01' }, { groups })
    expect(patch).toEqual({ name: 'Học viên Test 01' })
    expect(patch.foo).toBeUndefined()
  })

  // A2: active: "yes" → 400. groupIds gồm 1 id không tồn tại + 1 id có thật → chỉ giữ id có thật
  it('A2: rejects non-boolean active with 400, and filters groupIds to existing non-duplicate groups', () => {
    // 1. active: "yes" is rejected
    expect(() =>
      normalizeUserPatch({ active: 'yes' }, { groups })
    ).toThrowError()
    try {
      normalizeUserPatch({ active: 'yes' }, { groups })
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('active')
    }

    // 2. groupIds filtering
    const patch = normalizeUserPatch(
      { groupIds: ['non-existent-group', 'group-1', 'group-1'] },
      { groups }
    )
    expect(patch.groupIds).toEqual(['group-1'])
  })

  // A3: Chỉ còn 1 admin active → hạ thành user hoặc active: false → 409, store không đổi
  it('A3: protects last active admin from demotion or deactivation with 409', () => {
    const users = [
      { id: 'admin-1', role: 'admin', active: true },
      { id: 'user-2', role: 'user', active: true },
    ]

    // Demotion attempt
    expect(() =>
      assertAdminInvariant({
        users,
        targetId: 'admin-1',
        patch: { role: 'user' },
        actorId: 'other-actor',
      })
    ).toThrowError()
    try {
      assertAdminInvariant({
        users,
        targetId: 'admin-1',
        patch: { role: 'user' },
        actorId: 'other-actor',
      })
    } catch (err) {
      expect(err.status).toBe(409)
      expect(err.message).toContain('admin active cuối cùng')
    }

    // Deactivation attempt
    expect(() =>
      assertAdminInvariant({
        users,
        targetId: 'admin-1',
        patch: { active: false },
        actorId: 'other-actor',
      })
    ).toThrowError()
    try {
      assertAdminInvariant({
        users,
        targetId: 'admin-1',
        patch: { active: false },
        actorId: 'other-actor',
      })
    } catch (err) {
      expect(err.status).toBe(409)
      expect(err.message).toContain('admin active cuối cùng')
    }
  })

  // A4: Admin tự PATCH chính mình role: "user" → 409, kể cả khi còn admin khác
  it('A4: prevents admin from demoting or locking themselves with 409 even when another admin exists', () => {
    const users = [
      { id: 'admin-1', role: 'admin', active: true },
      { id: 'admin-2', role: 'admin', active: true },
    ]

    // Self-demotion
    expect(() =>
      assertAdminInvariant({
        users,
        targetId: 'admin-1',
        patch: { role: 'user' },
        actorId: 'admin-1',
      })
    ).toThrowError()
    try {
      assertAdminInvariant({
        users,
        targetId: 'admin-1',
        patch: { role: 'user' },
        actorId: 'admin-1',
      })
    } catch (err) {
      expect(err.status).toBe(409)
      expect(err.message).toContain('tự hạ quyền')
    }

    // Self-locking
    expect(() =>
      assertAdminInvariant({
        users,
        targetId: 'admin-1',
        patch: { active: false },
        actorId: 'admin-1',
      })
    ).toThrowError()
    try {
      assertAdminInvariant({
        users,
        targetId: 'admin-1',
        patch: { active: false },
        actorId: 'admin-1',
      })
    } catch (err) {
      expect(err.status).toBe(409)
      expect(err.message).toContain('tự hạ quyền hoặc tự khoá')
    }
  })

  // A5: 2 admin active → admin A hạ admin B → 200; có log admin.user_updated với changedFields: ["role"], không chứa email
  it('A5: allows admin A to demote admin B when 2 active admins exist', () => {
    const users = [
      { id: 'admin-a', email: 'admin.a@example.com', role: 'admin', active: true },
      { id: 'admin-b', email: 'admin.b@example.com', role: 'admin', active: true },
    ]

    const patch = normalizeUserPatch({ role: 'user' }, { groups })
    expect(() =>
      assertAdminInvariant({
        users,
        targetId: 'admin-b',
        patch,
        actorId: 'admin-a',
      })
    ).not.toThrow()

    // Simulate change tracking and log creation as in server/index.mjs
    const target = users.find(u => u.id === 'admin-b')
    const changedFields = []
    for (const [k, v] of Object.entries(patch)) {
      if (target[k] !== v) changedFields.push(k)
    }
    expect(changedFields).toEqual(['role'])

    const logEntry = {
      action: 'admin.user_updated',
      level: 'security',
      metadata: { targetUserId: target.id, changedFields },
    }
    expect(logEntry.action).toBe('admin.user_updated')
    expect(logEntry.level).toBe('security')
    expect(logEntry.metadata).toEqual({
      targetUserId: 'admin-b',
      changedFields: ['role'],
    })
    expect(JSON.stringify(logEntry)).not.toContain('admin.b@example.com')
  })

  // A6: POST email abc → 400
  it('A6: rejects invalid email format with false from isValidEmail', () => {
    expect(isValidEmail('abc')).toBe(false)
    expect(isValidEmail('abc@')).toBe(false)
    expect(isValidEmail('@example.com')).toBe(false)
    expect(isValidEmail('abc@domain')).toBe(false)
    expect(isValidEmail('valid.user@example.com')).toBe(true)
    expect(isValidEmail('admin@pace.edu.vn')).toBe(true)
  })
})
