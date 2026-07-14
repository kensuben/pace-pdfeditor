export type ActivityLevel = 'info' | 'success' | 'warning' | 'security'

export type ActivityEntry = {
  id: string
  timestamp: string
  userId: string
  userName: string
  action: string
  level: ActivityLevel
  description: string
  metadata?: Record<string, string | number | boolean | null>
  sessionId: string
}

const SESSION_KEY = 'paperly-session-id'
const LOG_PREFIX = 'paperly-activity:'

function sessionId() {
  let id = sessionStorage.getItem(SESSION_KEY)
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, id) }
  return id
}

export function loadActivities(userId: string): ActivityEntry[] {
  try { return JSON.parse(localStorage.getItem(LOG_PREFIX + userId) || '[]') }
  catch { return [] }
}

export function recordActivity(input: Omit<ActivityEntry, 'id' | 'timestamp' | 'sessionId'>): ActivityEntry {
  const entry: ActivityEntry = { ...input, id: crypto.randomUUID(), timestamp: new Date().toISOString(), sessionId: sessionId() }
  const logs = [entry, ...loadActivities(input.userId)].slice(0, 1000)
  localStorage.setItem(LOG_PREFIX + input.userId, JSON.stringify(logs))
  window.dispatchEvent(new CustomEvent('paperly-activity', { detail: entry }))
  return entry
}

export function clearActivities(userId: string) {
  localStorage.removeItem(LOG_PREFIX + userId)
  window.dispatchEvent(new CustomEvent('paperly-activity'))
}

