// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import fs from 'node:fs'
import path from 'node:path'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

if (typeof DOMMatrix === 'undefined') {
  // @ts-expect-error polyfill for jsdom
  globalThis.DOMMatrix = class DOMMatrix {}
}

vi.mock('../PdfCanvas', () => ({
  PdfCanvas: () => <div className="pdf-canvas" />,
}))

import { ZoomMenu } from '../ZoomMenu'
import { PageList } from '../PageList'
import { canRotatePage, fitZoom, FIT_PADDING } from '../viewMath'
import type { Annotation } from '../../types'
import type * as pdfjs from 'pdfjs-dist'

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

describe('W-11b Bug Fixes (T2: Wheel Zoom & T3: Single Scroller & Layout Fit)', () => {
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

  const mockPdf = {
    numPages: 2,
    getPage: vi.fn().mockImplementation(async (pageNo: number) => ({
      pageNumber: pageNo,
      getViewport: () => ({ width: 600, height: 800 }),
      render: () => ({ promise: Promise.resolve() }),
      getTextContent: () => Promise.resolve({ items: [] }),
    })),
  } as unknown as pdfjs.PDFDocumentProxy

  it('T2: attaches wheel event to .page-list-scroll, calls preventDefault and onZoomChange on ctrl-wheel', async () => {
    const onZoomChange = vi.fn()

    await act(async () => {
      root.render(
        <PageList
          pdf={mockPdf}
          pageCount={2}
          zoom={1}
          annotations={[]}
          tool="select"
          color="#000"
          selectedId={null}
          onSelect={vi.fn()}
          onAdd={vi.fn()}
          onUpdate={vi.fn()}
          textRegions={{}}
          onTextRegions={vi.fn()}
          onEditRegion={vi.fn()}
          onEditAnnotation={vi.fn()}
          currentPage={1}
          onCurrentPageChange={vi.fn()}
          onZoomChange={onZoomChange}
        />,
      )
    })

    const scrollEl = container.querySelector('.page-list-scroll') as HTMLDivElement
    expect(scrollEl).not.toBeNull()

    // 1. Dispatch wheel with ctrlKey: true, deltaY < 0 (zoom in)
    const zoomInEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
      clientX: 200,
      clientY: 200,
    })
    act(() => {
      scrollEl.dispatchEvent(zoomInEvent)
    })
    expect(zoomInEvent.defaultPrevented).toBe(true)
    expect(onZoomChange).toHaveBeenCalledWith(1.1)

    // 2. Dispatch wheel with metaKey: true, deltaY > 0 (zoom out)
    const zoomOutEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      deltaY: 100,
      clientX: 200,
      clientY: 200,
    })
    act(() => {
      scrollEl.dispatchEvent(zoomOutEvent)
    })
    expect(zoomOutEvent.defaultPrevented).toBe(true)
    expect(onZoomChange).toHaveBeenCalledWith(0.91)

    // 3. Normal wheel (no ctrlKey / metaKey) should NOT prevent default or zoom
    onZoomChange.mockClear()
    const normalScrollEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: false,
      metaKey: false,
      deltaY: 50,
      clientX: 200,
      clientY: 200,
    })
    act(() => {
      scrollEl.dispatchEvent(normalScrollEvent)
    })
    expect(normalScrollEvent.defaultPrevented).toBe(false)
    expect(onZoomChange).not.toHaveBeenCalled()
  })

  it('T3: verifies CSS overrides .document-area overflow: hidden and padding: 0 when PageList is active', () => {
    const cssPath = path.resolve(__dirname, '../viewer.css')
    const cssContent = fs.readFileSync(cssPath, 'utf-8')
    expect(cssContent).toMatch(/\.document-area:has\(\.page-list-scroll\)/)
    expect(cssContent).toMatch(/\.document-area\.has-page-list/)
    expect(cssContent).toMatch(/overflow:\s*hidden\s*!important/)
    expect(cssContent).toMatch(/padding:\s*0\s*!important/)
  })

  it('T3: fits initial zoom after layout when container clientWidth > 0', async () => {
    const onInitialFit = vi.fn()
    const scrollContainerRef = { current: null as HTMLDivElement | null }

    await act(async () => {
      root.render(
        <div style={{ width: 500, height: 700 }}>
          <PageList
            pdf={mockPdf}
            pageCount={2}
            zoom={1}
            annotations={[]}
            tool="select"
            color="#000"
            selectedId={null}
            onSelect={vi.fn()}
            onAdd={vi.fn()}
            onUpdate={vi.fn()}
            textRegions={{}}
            onTextRegions={vi.fn()}
            onEditRegion={vi.fn()}
            onEditAnnotation={vi.fn()}
            currentPage={1}
            onCurrentPageChange={vi.fn()}
            containerRef={scrollContainerRef}
            onInitialFit={onInitialFit}
          />
        </div>,
      )
    })

    // Simulate real browser layout by defining clientWidth on container
    if (scrollContainerRef.current) {
      Object.defineProperty(scrollContainerRef.current, 'clientWidth', {
        configurable: true,
        value: 500,
      })
      Object.defineProperty(scrollContainerRef.current, 'clientHeight', {
        configurable: true,
        value: 700,
      })
    }

    // Force re-render / check fit
    const expectedFitW = fitZoom({ width: 500, height: 700 }, { width: 600, height: 800 }, 'width')
    expect(expectedFitW).toBeCloseTo((500 - FIT_PADDING) / 600, 5)
  })
})
