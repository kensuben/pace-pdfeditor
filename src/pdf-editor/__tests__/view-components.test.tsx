// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ZoomMenu } from '../ZoomMenu'
import { canRotatePage } from '../viewMath'
import type { Annotation } from '../../types'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ZoomMenu Component Tests (W-11)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    return () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('renders zoom presets, role="menu", role="menuitem", handles selection', () => {
    const onSelectZoom = vi.fn()
    const onFitWidth = vi.fn()
    const onFitPage = vi.fn()
    const onClose = vi.fn()

    act(() => {
      root.render(
        <ZoomMenu
          isOpen={true}
          onClose={onClose}
          currentZoom={1}
          onSelectZoom={onSelectZoom}
          onFitWidth={onFitWidth}
          onFitPage={onFitPage}
        />,
      )
    })

    const menu = container.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()

    const items = container.querySelectorAll('[role="menuitem"]')
    expect(items.length).toBeGreaterThanOrEqual(10)

    // Click fit width
    const fitWidthBtn = Array.from(items).find(
      (btn) => btn.textContent?.includes('Vừa chiều rộng'),
    ) as HTMLButtonElement
    expect(fitWidthBtn).toBeDefined()
    act(() => {
      fitWidthBtn.click()
    })
    expect(onFitWidth).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    // Click 150%
    const z150Btn = Array.from(items).find(
      (btn) => btn.textContent?.includes('150%'),
    ) as HTMLButtonElement
    expect(z150Btn).toBeDefined()
    act(() => {
      z150Btn.click()
    })
    expect(onSelectZoom).toHaveBeenCalledWith(1.5)
  })

  it('handles Escape key to close menu', () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <ZoomMenu
          isOpen={true}
          onClose={onClose}
          currentZoom={1}
          onSelectZoom={vi.fn()}
          onFitWidth={vi.fn()}
          onFitPage={vi.fn()}
        />,
      )
    })

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Page Rotation Button Disable Logic (W-11 Bổ sung bắt buộc)', () => {
  it('disables rotation when page contains replaceOriginal annotation', () => {
    const normalAnn: Annotation = {
      id: 'a1',
      page: 1,
      type: 'highlight',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      color: '#fff',
      opacity: 1,
    }
    const replaceAnn: Annotation = {
      id: 'a2',
      page: 1,
      type: 'text',
      text: 'New Name',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      color: '#000',
      opacity: 1,
      replaceOriginal: true,
    }

    // Normal annotation allows rotation
    expect(canRotatePage([normalAnn], 1)).toBe(true)

    // With replaceOriginal on page 1 -> disallowed
    expect(canRotatePage([normalAnn, replaceAnn], 1)).toBe(false)

    // If replaceOriginal is on page 2, page 1 is allowed
    const p2Replace = { ...replaceAnn, page: 2 }
    expect(canRotatePage([normalAnn, p2Replace], 1)).toBe(true)
    expect(canRotatePage([normalAnn, p2Replace], 2)).toBe(false)
  })
})
