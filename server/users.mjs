export function isValidEmail(email) {
  if (typeof email !== 'string') return false
  const clean = email.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)
}

export function normalizeUserPatch(input, { groups = [] } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const err = new Error('Dữ liệu không hợp lệ')
    err.status = 400
    throw err
  }

  const patch = {}

  if ('name' in input) {
    if (typeof input.name !== 'string') {
      const err = new Error('name không hợp lệ')
      err.status = 400
      throw err
    }
    const cleanName = input.name.trim()
    if (cleanName.length < 1 || cleanName.length > 100) {
      const err = new Error('name phải từ 1 đến 100 ký tự')
      err.status = 400
      throw err
    }
    patch.name = cleanName
  }

  if ('role' in input) {
    if (input.role !== 'admin' && input.role !== 'user') {
      const err = new Error('role không hợp lệ')
      err.status = 400
      throw err
    }
    patch.role = input.role
  }

  if ('active' in input) {
    if (typeof input.active !== 'boolean') {
      const err = new Error('active phải là boolean')
      err.status = 400
      throw err
    }
    patch.active = input.active
  }

  if ('groupIds' in input) {
    if (!Array.isArray(input.groupIds)) {
      const err = new Error('groupIds phải là mảng')
      err.status = 400
      throw err
    }
    const validGroupIds = new Set(groups.map(g => (typeof g === 'string' ? g : g.id)))
    const seen = new Set()
    const filtered = []
    for (const gid of input.groupIds) {
      if (typeof gid === 'string' && validGroupIds.has(gid) && !seen.has(gid)) {
        seen.add(gid)
        filtered.push(gid)
      }
    }
    patch.groupIds = filtered
  }

  return patch
}

export function assertAdminInvariant({ users = [], targetId, patch = {}, actorId }) {
  const targetUser = users.find(u => u.id === targetId)
  if (!targetUser) return

  // Prevent admin from demoting or disabling themselves
  if (actorId && actorId === targetId) {
    if ((patch.role !== undefined && patch.role !== 'admin') || patch.active === false) {
      const err = new Error('Admin không thể tự hạ quyền hoặc tự khoá tài khoản')
      err.status = 409
      throw err
    }
  }

  // Check if after patch there remains at least 1 active admin
  const projectedRole = patch.role !== undefined ? patch.role : targetUser.role
  const projectedActive = patch.active !== undefined ? patch.active : targetUser.active

  let activeAdminsCount = 0
  for (const u of users) {
    const role = u.id === targetId ? projectedRole : u.role
    const active = u.id === targetId ? projectedActive : u.active
    if (role === 'admin' && active === true) {
      activeAdminsCount++
    }
  }

  if (activeAdminsCount === 0) {
    const err = new Error('Không thể hạ quyền hoặc khoá admin active cuối cùng')
    err.status = 409
    throw err
  }
}
