import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { AccountInfo } from '@azure/msal-browser'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

if (typeof DOMMatrix === 'undefined') {
  // @ts-expect-error polyfill for jsdom
  globalThis.DOMMatrix = class DOMMatrix {}
}

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
}))

import App from '../App'

const mockAccount: AccountInfo = {
  homeAccountId: 'test-home-id',
  environment: 'login.windows.net',
  tenantId: 'test-tenant-id',
  username: 'test.user@example.com',
  localAccountId: 'test-local-id',
  name: 'Test User',
}

let currentAccount: AccountInfo | null = null

vi.mock('../auth', () => ({
  initializeAuth: vi.fn(async () => currentAccount),
  isMicrosoftAuthConfigured: true,
  signInMicrosoft: vi.fn(async () => mockAccount),
  signOutMicrosoft: vi.fn(async () => {}),
  getMicrosoftToken: vi.fn(async () => 'mock-token'),
}))

vi.mock('../api', () => ({
  authorizeSession: vi.fn(async () => ({ user: { id: 'test-user', role: 'user', username: 'test.user@example.com' } })),
  apiRequest: vi.fn(async () => ({})),
}))

vi.mock('../activityLog', () => ({
  recordActivity: vi.fn(),
  listActivities: vi.fn(async () => []),
  exportActivitiesJson: vi.fn(() => ''),
  clearActivities: vi.fn(),
}))

describe('Topbar Help Link (W-4 K1)', () => {
  beforeEach(() => {
    currentAccount = null
  })

  it('renders help link in topbar when not logged in, placed before microsoft-login button', async () => {
    currentAccount = null
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    const helpLink = container.querySelector('a.topbar-help-link')
    expect(helpLink).not.toBeNull()
    expect(helpLink?.getAttribute('href')).toBe('/huong-dan/')
    expect(helpLink?.getAttribute('target')).toBe('_blank')
    expect(helpLink?.getAttribute('rel')).toBe('noopener')
    expect(helpLink?.getAttribute('aria-label')).toBe('Hướng dẫn sử dụng')
    expect(helpLink?.getAttribute('title')).toBe('Hướng dẫn sử dụng')
    expect(helpLink?.textContent).toContain('Hướng dẫn')

    // Verify it is placed inside .top-actions directly before .microsoft-login
    const topActions = container.querySelector('.top-actions')
    expect(topActions).not.toBeNull()
    const msLogin = topActions?.querySelector('.microsoft-login')
    expect(msLogin).not.toBeNull()
    expect(helpLink?.nextElementSibling).toBe(msLogin)

    root.unmount()
    container.remove()
  })

  it('renders help link in topbar when logged in, placed before account-menu / activity button', async () => {
    currentAccount = mockAccount
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    const helpLink = container.querySelector('a.topbar-help-link')
    expect(helpLink).not.toBeNull()
    expect(helpLink?.getAttribute('href')).toBe('/huong-dan/')
    expect(helpLink?.getAttribute('target')).toBe('_blank')
    expect(helpLink?.getAttribute('rel')).toBe('noopener')
    expect(helpLink?.getAttribute('aria-label')).toBe('Hướng dẫn sử dụng')
    expect(helpLink?.getAttribute('title')).toBe('Hướng dẫn sử dụng')

    // Verify it is placed inside .top-actions directly before .account-menu
    const topActions = container.querySelector('.top-actions')
    expect(topActions).not.toBeNull()
    const accountMenu = topActions?.querySelector('.account-menu')
    expect(accountMenu).not.toBeNull()
    expect(helpLink?.nextElementSibling).toBe(accountMenu)

    // Activity button is the first child of account-menu
    const activityBtn = accountMenu?.querySelector('.activity-button')
    expect(activityBtn).not.toBeNull()

    root.unmount()
    container.remove()
  })
})
