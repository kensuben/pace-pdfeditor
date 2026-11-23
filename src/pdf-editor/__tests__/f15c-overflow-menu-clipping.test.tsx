import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ToolbarOverflowMenu } from '../ToolbarOverflowMenu'

// @ts-expect-error global act environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('F-15c: Overflow menu clipping, portal outside scroll container, and preventScroll focus', () => {
  let container: HTMLDivElement
  let toolbar: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    container.appendChild(toolbar)
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
    // Clean up any stray portals attached to document.body
    const strayMenus = document.body.querySelectorAll('[role="menu"]')
    strayMenus.forEach((m) => m.remove())
    vi.restoreAllMocks()
  })

  it('K1: renders [role="menu"] in document.body outside .toolbar with style.position === "fixed"', () => {
    const root = createRoot(toolbar)

    act(() => {
      root.render(
        <ToolbarOverflowMenu
          hiddenGroups={['page', 'signOcr']}
          onInsertImage={vi.fn()}
          onInsertPage={vi.fn()}
          page={2}
          pageCount={5}
          onMovePage={vi.fn()}
          onRotatePage={vi.fn()}
          canRotate={true}
          rotateLabel="Xoay trang"
          onDeletePage={vi.fn()}
          onSign={vi.fn()}
          onScanOcr={vi.fn()}
          ocrBusy={false}
          ocrProgress={0}
        />
      )
    })

    const triggerBtn = toolbar.querySelector(
      'button[aria-label="Thêm thao tác"]'
    ) as HTMLButtonElement
    expect(triggerBtn).not.toBeNull()

    // Open menu
    act(() => {
      triggerBtn.click()
    })

    // Menu must be in document.body
    const menuInBody = document.body.querySelector('[role="menu"]') as HTMLElement
    expect(menuInBody).not.toBeNull()
    expect(document.body.contains(menuInBody)).toBe(true)

    // Menu must NOT be inside .toolbar
    expect(toolbar.querySelector('[role="menu"]')).toBeNull()
    expect(toolbar.contains(menuInBody)).toBe(false)

    // style.position must be 'fixed'
    expect(menuInBody.style.position).toBe('fixed')

    root.unmount()
  })

  it('K2: clicking "Xoay trang" calls handler once then closes; Esc closes and restores focus; disabled items do not trigger handler', () => {
    const root = createRoot(toolbar)
    const onRotatePage = vi.fn()

    act(() => {
      root.render(
        <ToolbarOverflowMenu
          hiddenGroups={['page']}
          onInsertImage={vi.fn()}
          onInsertPage={vi.fn()}
          page={1} // page 1 disables move up
          pageCount={5}
          onMovePage={vi.fn()}
          onRotatePage={onRotatePage}
          canRotate={true}
          rotateLabel="Xoay trang"
          onDeletePage={vi.fn()}
          onSign={vi.fn()}
          onScanOcr={vi.fn()}
          ocrBusy={false}
          ocrProgress={0}
        />
      )
    })

    const triggerBtn = toolbar.querySelector(
      'button[aria-label="Thêm thao tác"]'
    ) as HTMLButtonElement

    // 1. Open menu and click enabled item "Xoay trang"
    act(() => {
      triggerBtn.click()
    })

    const menu = document.body.querySelector('[role="menu"]') as HTMLElement
    expect(menu).not.toBeNull()

    const rotateBtn = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')
    ).find((b) => b.textContent?.includes('Xoay trang'))
    expect(rotateBtn).toBeDefined()

    act(() => {
      rotateBtn?.click()
    })

    expect(onRotatePage).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    // 2. Open again and test Esc key
    act(() => {
      triggerBtn.click()
    })
    const menu2 = document.body.querySelector('[role="menu"]') as HTMLElement
    expect(menu2).not.toBeNull()

    act(() => {
      menu2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(triggerBtn)

    // 3. Open again and test disabled item (move page up when page === 1)
    act(() => {
      triggerBtn.click()
    })
    const menu3 = document.body.querySelector('[role="menu"]') as HTMLElement
    const disabledMoveUpBtn = Array.from(
      menu3.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')
    ).find((b) => b.textContent?.includes('Di chuyển trang lên'))

    expect(disabledMoveUpBtn).toBeDefined()
    expect(disabledMoveUpBtn?.disabled).toBe(true)
    expect(disabledMoveUpBtn?.getAttribute('aria-disabled')).toBe('true')

    const onMovePage = vi.fn()
    // Re-render with mocked onMovePage
    act(() => {
      root.render(
        <ToolbarOverflowMenu
          hiddenGroups={['page']}
          onInsertImage={vi.fn()}
          onInsertPage={vi.fn()}
          page={1}
          pageCount={5}
          onMovePage={onMovePage}
          onRotatePage={onRotatePage}
          canRotate={true}
          rotateLabel="Xoay trang"
          onDeletePage={vi.fn()}
          onSign={vi.fn()}
          onScanOcr={vi.fn()}
          ocrBusy={false}
          ocrProgress={0}
        />
      )
    })

    act(() => {
      disabledMoveUpBtn?.click()
    })
    expect(onMovePage).not.toHaveBeenCalled()
    // Menu remains open
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()

    root.unmount()
  })

  it('K3: all calls to focus() in menu lifecycle provide { preventScroll: true }', () => {
    const root = createRoot(toolbar)
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')

    act(() => {
      root.render(
        <ToolbarOverflowMenu
          hiddenGroups={['page']}
          onInsertImage={vi.fn()}
          onInsertPage={vi.fn()}
          page={2}
          pageCount={5}
          onMovePage={vi.fn()}
          onRotatePage={vi.fn()}
          canRotate={true}
          rotateLabel="Xoay trang"
          onDeletePage={vi.fn()}
          onSign={vi.fn()}
          onScanOcr={vi.fn()}
          ocrBusy={false}
          ocrProgress={0}
        />
      )
    })

    const triggerBtn = toolbar.querySelector(
      'button[aria-label="Thêm thao tác"]'
    ) as HTMLButtonElement

    // Open menu (triggers initial item focus)
    act(() => {
      triggerBtn.click()
    })

    const menu = document.body.querySelector('[role="menu"]') as HTMLElement
    expect(menu).not.toBeNull()

    // ArrowDown navigation
    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })

    // ArrowUp navigation
    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })

    // Close via Esc (triggers return focus to triggerBtn)
    act(() => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    // Every recorded call to focus() must have { preventScroll: true }
    expect(focusSpy).toHaveBeenCalled()
    for (const call of focusSpy.mock.calls) {
      expect(call[0]).toEqual({ preventScroll: true })
    }

    root.unmount()
  })

  it('K4: window resize event closes the open menu', () => {
    const root = createRoot(toolbar)

    act(() => {
      root.render(
        <ToolbarOverflowMenu
          hiddenGroups={['page']}
          onInsertImage={vi.fn()}
          onInsertPage={vi.fn()}
          page={2}
          pageCount={5}
          onMovePage={vi.fn()}
          onRotatePage={vi.fn()}
          canRotate={true}
          rotateLabel="Xoay trang"
          onDeletePage={vi.fn()}
          onSign={vi.fn()}
          onScanOcr={vi.fn()}
          ocrBusy={false}
          ocrProgress={0}
        />
      )
    })

    const triggerBtn = toolbar.querySelector(
      'button[aria-label="Thêm thao tác"]'
    ) as HTMLButtonElement

    act(() => {
      triggerBtn.click()
    })

    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()

    // Dispatch resize on window
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    root.unmount()
  })

  it('K4 extra: window scroll event outside menu closes the open menu', () => {
    const root = createRoot(toolbar)

    act(() => {
      root.render(
        <ToolbarOverflowMenu
          hiddenGroups={['page']}
          onInsertImage={vi.fn()}
          onInsertPage={vi.fn()}
          page={2}
          pageCount={5}
          onMovePage={vi.fn()}
          onRotatePage={vi.fn()}
          canRotate={true}
          rotateLabel="Xoay trang"
          onDeletePage={vi.fn()}
          onSign={vi.fn()}
          onScanOcr={vi.fn()}
          ocrBusy={false}
          ocrProgress={0}
        />
      )
    })

    const triggerBtn = toolbar.querySelector(
      'button[aria-label="Thêm thao tác"]'
    ) as HTMLButtonElement

    act(() => {
      triggerBtn.click()
    })

    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()

    // Dispatch scroll on window
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })

    expect(document.body.querySelector('[role="menu"]')).toBeNull()

    root.unmount()
  })

  it('positions menu relative to trigger button and flips up if bottom overflows viewport', () => {
    const root = createRoot(toolbar)

    act(() => {
      root.render(
        <ToolbarOverflowMenu
          hiddenGroups={['page']}
          onInsertImage={vi.fn()}
          onInsertPage={vi.fn()}
          page={2}
          pageCount={5}
          onMovePage={vi.fn()}
          onRotatePage={vi.fn()}
          canRotate={true}
          rotateLabel="Xoay trang"
          onDeletePage={vi.fn()}
          onSign={vi.fn()}
          onScanOcr={vi.fn()}
          ocrBusy={false}
          ocrProgress={0}
        />
      )
    })

    const triggerBtn = toolbar.querySelector(
      'button[aria-label="Thêm thao tác"]'
    ) as HTMLButtonElement

    // Simulate button near bottom of a 720px viewport
    vi.spyOn(triggerBtn, 'getBoundingClientRect').mockReturnValue({
      top: 680,
      bottom: 712,
      left: 900,
      right: 932,
      width: 32,
      height: 32,
      x: 900,
      y: 680,
      toJSON: () => {},
    })

    act(() => {
      triggerBtn.click()
    })

    const menu = document.body.querySelector('[role="menu"]') as HTMLElement
    expect(menu).not.toBeNull()

    // Because bottom (712 + 6 + 260 = 978) exceeds window.innerHeight (768),
    // top should flip above button (top = 680 - 6 - menuHeight)
    const topValue = parseInt(menu.style.top, 10)
    expect(topValue).toBeLessThan(680)

    root.unmount()
  })
})
