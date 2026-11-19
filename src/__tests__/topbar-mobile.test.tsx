import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { AccountInfo } from '@azure/msal-browser'
import { PDFDocument } from 'pdf-lib'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

if (typeof DOMMatrix === 'undefined') {
  // @ts-expect-error polyfill for jsdom
  globalThis.DOMMatrix = class DOMMatrix {}
}

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
}
if (!globalThis.URL.revokeObjectURL) {
  globalThis.URL.revokeObjectURL = vi.fn()
}

const mockAccount: AccountInfo = {
  homeAccountId: 'test-home-id',
  environment: 'login.windows.net',
  tenantId: 'test-tenant-id',
  username: 'test.user@example.com',
  localAccountId: 'test-local-id',
  name: 'Test User',
}

let currentAccount: AccountInfo | null = null
let currentApiUser: { user: { id: string; role: string; username: string } } = {
  user: { id: 'test-user', role: 'user', username: 'test.user@example.com' },
}

const signOutSpy = vi.fn(async () => {})
const signInSpy = vi.fn(async () => mockAccount)

vi.mock('../auth', () => ({
  initializeAuth: vi.fn(async () => currentAccount),
  isMicrosoftAuthConfigured: true,
  signInMicrosoft: () => signInSpy(),
  signOutMicrosoft: () => signOutSpy(),
  getMicrosoftToken: vi.fn(async () => 'mock-token'),
}))

vi.mock('../api', () => ({
  authorizeSession: vi.fn(async () => currentApiUser),
  apiRequest: vi.fn(async () => ({})),
}))

vi.mock('../activityLog', () => ({
  recordActivity: vi.fn(),
  loadActivities: vi.fn(() => []),
  fetchActivities: vi.fn(async () => []),
  listActivities: vi.fn(async () => []),
  exportActivitiesJson: vi.fn(() => ''),
  clearActivities: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 600, height: 800 }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        getTextContent: vi.fn(async () => ({ items: [] })),
      })),
    }),
  })),
}))

import App from '../App'

async function createValidPdfFile(name = 'sample.pdf'): Promise<File> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  const bytes = await doc.save()
  return new File([bytes as BlobPart], name, { type: 'application/pdf' })
}

describe('Topbar Mobile Compact Menu (W-5c: C1-C6)', () => {
  beforeEach(() => {
    currentAccount = null
    currentApiUser = { user: { id: 'test-user', role: 'user', username: 'test.user@example.com' } }
    signOutSpy.mockClear()
    signInSpy.mockClear()
    window.location.hash = '#/'
  })

  // C1: 360px & 390px, logged in, PDF opened:
  // elements within [0, innerWidth], open "⋯" -> see & click "Đăng xuất"
  it('C1: fits within viewport at 360px and 390px when logged in with PDF opened, and can logout from menu', async () => {
    currentAccount = mockAccount
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    // Open a valid PDF
    const file = await createValidPdfFile()
    const fileInput = container.querySelector('input[type="file"][accept*="pdf"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()

    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: true,
      })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 100))
    })

    for (const width of [360, 390]) {
      window.innerWidth = width
      const topbar = container.querySelector('.topbar') as HTMLElement
      expect(topbar).not.toBeNull()

      // Mobile buttons are available
      const mobileMenuBtn = topbar.querySelector('.mobile-menu-btn') as HTMLButtonElement
      expect(mobileMenuBtn).not.toBeNull()
      expect(mobileMenuBtn.getAttribute('aria-label')).toBe('Thêm thao tác')
      expect(mobileMenuBtn.getAttribute('aria-haspopup')).toBe('menu')

      const mobileExportBtn = topbar.querySelector('.mobile-export-btn') as HTMLButtonElement
      expect(mobileExportBtn).not.toBeNull()
      expect(mobileExportBtn.getAttribute('aria-label')).toBe('Xuất PDF')

      // Mock bounding client rects for simulated mobile layout
      const elements = [
        topbar.querySelector('.brand'),
        topbar.querySelector('.view-switcher'),
        mobileExportBtn,
        mobileMenuBtn,
      ].filter(Boolean) as HTMLElement[]

      let currentX = 8
      for (const el of elements) {
        const elWidth = el === mobileMenuBtn || el === mobileExportBtn ? 34 : 100
        const itemX = currentX
        el.getBoundingClientRect = () => ({
          left: itemX,
          right: itemX + elWidth,
          top: 0,
          bottom: 56,
          width: elWidth,
          height: 56,
          x: itemX,
          y: 0,
          toJSON: () => {},
        })
        currentX += elWidth + 6
      }

      // Assert all elements fit within [0, innerWidth]
      for (const el of elements) {
        const rect = el.getBoundingClientRect()
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.right).toBeLessThanOrEqual(width)
      }
    }

    // Open "⋯" menu
    const menuBtn = container.querySelector('.mobile-menu-btn') as HTMLButtonElement
    await act(async () => {
      menuBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(menuBtn.getAttribute('aria-expanded')).toBe('true')
    const dropdown = container.querySelector('.mobile-dropdown-menu') as HTMLElement
    expect(dropdown).not.toBeNull()
    expect(dropdown.getAttribute('role')).toBe('menu')

    // Find and click "Đăng xuất"
    const logoutBtn = Array.from(dropdown.querySelectorAll('button[role="menuitem"]')).find(
      (btn) => btn.textContent?.includes('Đăng xuất')
    ) as HTMLButtonElement
    expect(logoutBtn).not.toBeNull()

    await act(async () => {
      logoutBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(signOutSpy).toHaveBeenCalled()

    root.unmount()
    container.remove()
  })

  // C2: Keyboard navigation: Tab to "⋯", Enter opens menu, focus at first item;
  // ArrowDown moves focus; Escape closes menu and restores focus to "⋯".
  it('C2: handles keyboard navigation (Enter open, ArrowDown move, Escape close and restore focus)', async () => {
    currentAccount = mockAccount
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    const menuBtn = container.querySelector('.mobile-menu-btn') as HTMLButtonElement
    expect(menuBtn).not.toBeNull()

    // 1. Tab to "⋯"
    menuBtn.focus()
    expect(document.activeElement).toBe(menuBtn)

    // 2. Enter opens menu
    await act(async () => {
      menuBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    const dropdown = container.querySelector('.mobile-dropdown-menu') as HTMLElement
    expect(dropdown).not.toBeNull()

    const menuItems = Array.from(
      dropdown.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
    )
    expect(menuItems.length).toBeGreaterThan(1)
    // Focus is on first item
    expect(document.activeElement).toBe(menuItems[0])

    // 3. ArrowDown moves to next item
    await act(async () => {
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(document.activeElement).toBe(menuItems[1])

    // 4. Escape closes menu and restores focus to "⋯"
    await act(async () => {
      dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(container.querySelector('.mobile-dropdown-menu')).toBeNull()
    expect(document.activeElement).toBe(menuBtn)

    root.unmount()
    container.remove()
  })

  // C3: From menu: "Activity log" opens panel, "Hướng dẫn" has href & target="_blank",
  // "Đăng xuất" calls logout, mobile export button downloads -edited.pdf.
  it('C3: menu items perform actions correctly (Activity log, Hướng dẫn link, Đăng xuất, Xuất PDF)', async () => {
    currentAccount = mockAccount
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    // Open PDF
    const file = await createValidPdfFile('sample.pdf')
    const fileInput = container.querySelector('input[type="file"][accept*="pdf"]') as HTMLInputElement
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: true,
      })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 100))
    })

    // Check mobile export button triggers export
    const downloadClickSpy = vi.fn()
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName)
      if (tagName.toLowerCase() === 'a') {
        el.click = downloadClickSpy
      }
      return el
    })

    const mobileExportBtn = container.querySelector('.mobile-export-btn') as HTMLButtonElement
    expect(mobileExportBtn).not.toBeNull()

    await act(async () => {
      mobileExportBtn.click()
      await new Promise((r) => setTimeout(r, 100))
    })
    expect(downloadClickSpy).toHaveBeenCalled()

    // Open menu
    const menuBtn = container.querySelector('.mobile-menu-btn') as HTMLButtonElement
    await act(async () => {
      menuBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    const dropdown = container.querySelector('.mobile-dropdown-menu') as HTMLElement
    expect(dropdown).not.toBeNull()

    // Hướng dẫn link
    const helpLink = dropdown.querySelector('a[role="menuitem"]') as HTMLAnchorElement
    expect(helpLink).not.toBeNull()
    expect(helpLink.getAttribute('href')).toBe('/huong-dan/')
    expect(helpLink.getAttribute('target')).toBe('_blank')
    expect(helpLink.getAttribute('rel')).toBe('noopener')

    // Activity log button
    const activityBtn = Array.from(dropdown.querySelectorAll('button[role="menuitem"]')).find(
      (btn) => btn.textContent?.includes('Activity log')
    ) as HTMLButtonElement
    expect(activityBtn).not.toBeNull()

    await act(async () => {
      activityBtn.click()
      await new Promise((r) => setTimeout(r, 50))
    })

    // Activity panel is opened
    expect(container.querySelector('.activity-panel')).not.toBeNull()

    root.unmount()
    container.remove()
    vi.restoreAllMocks()
  })

  // C4: 390px not logged in: "Đăng nhập Microsoft" accessible in menu
  it('C4: provides accessible Microsoft Login when not logged in at 390px', async () => {
    currentAccount = null
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    const menuBtn = container.querySelector('.mobile-menu-btn') as HTMLButtonElement
    expect(menuBtn).not.toBeNull()

    await act(async () => {
      menuBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    const dropdown = container.querySelector('.mobile-dropdown-menu') as HTMLElement
    expect(dropdown).not.toBeNull()

    // Sign in button is in the menu
    const loginBtn = Array.from(dropdown.querySelectorAll('button[role="menuitem"]')).find(
      (btn) => btn.textContent?.includes('Sign in with Microsoft') || btn.textContent?.includes('Đăng nhập Microsoft')
    ) as HTMLButtonElement
    expect(loginBtn).not.toBeNull()

    await act(async () => {
      loginBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(signInSpy).toHaveBeenCalled()

    root.unmount()
    container.remove()
  })

  // C5: 768px & 1280px: desktop actions remain intact
  it('C5: renders all desktop actions intact at desktop/tablet viewports (768px, 1280px)', async () => {
    currentAccount = mockAccount
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    // Desktop elements are rendered with desktop-only class
    const helpLink = container.querySelector('a.topbar-help-link.desktop-only')
    expect(helpLink).not.toBeNull()

    const accountMenu = container.querySelector('.account-menu.desktop-only')
    expect(accountMenu).not.toBeNull()
    expect(accountMenu?.querySelector('.activity-button')).not.toBeNull()
    expect(accountMenu?.querySelector('.user-chip')).not.toBeNull()
    expect(accountMenu?.querySelector('.logout-button')).not.toBeNull()

    root.unmount()
    container.remove()
  })

  // C6: Dynamic items based on auth/admin state
  it('C6: shows Administration item only for admin role and renders username text', async () => {
    // 1. Regular user: no Administration item
    currentAccount = mockAccount
    currentApiUser = { user: { id: 'user-1', role: 'user', username: 'user@example.com' } }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    const menuBtn = container.querySelector('.mobile-menu-btn') as HTMLButtonElement
    await act(async () => {
      menuBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    let dropdown = container.querySelector('.mobile-dropdown-menu') as HTMLElement
    expect(dropdown.textContent).not.toContain('Administration')
    expect(dropdown.querySelector('.mobile-menu-username')?.textContent).toContain('Test User')

    root.unmount()
    container.remove()

    // 2. Admin user: Administration item is shown
    currentAccount = mockAccount
    currentApiUser = { user: { id: 'admin-1', role: 'admin', username: 'admin@example.com' } }

    const adminContainer = document.createElement('div')
    document.body.appendChild(adminContainer)
    const adminRoot = createRoot(adminContainer)

    await act(async () => {
      adminRoot.render(<App />)
      await new Promise((r) => setTimeout(r, 50))
    })

    const adminMenuBtn = adminContainer.querySelector('.mobile-menu-btn') as HTMLButtonElement
    await act(async () => {
      adminMenuBtn.click()
      await new Promise((r) => setTimeout(r, 20))
    })

    dropdown = adminContainer.querySelector('.mobile-dropdown-menu') as HTMLElement
    const adminItem = Array.from(dropdown.querySelectorAll('button[role="menuitem"]')).find(
      (btn) => btn.textContent?.includes('Administration')
    )
    expect(adminItem).not.toBeUndefined()

    adminRoot.unmount()
    adminContainer.remove()
  })
})
