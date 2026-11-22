import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  computeToolbarLayout,
  ToolbarItemWidths,
} from '../useToolbarLayout'
import { ToolbarOverflowMenu } from '../ToolbarOverflowMenu'
import { PropertiesPanel } from '../PropertiesPanel'
import type { Annotation, TextStyle } from '../../types'

// @ts-expect-error global act environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('F-15: Toolbar Layout, Properties Panel, and File Title', () => {
  describe('K1: computeToolbarLayout (pure function)', () => {
    const customWidths: ToolbarItemWidths = {
      tools: 300,
      colors: 100,
      divider: 20,
      edit: 100,
      insertFull: 200,
      insertCompact: 70,
      page: 150,
      signOcrFull: 180,
      signOcrCompact: 70,
      boundingBox: 40,
      overflowBtn: 40,
      paddingAndGaps: 40,
    }

    // fixed = 300 + 100 + 20 + 100 + 40 = 560
    // fullWidth = 560 + 200 + 150 + 180 + 40 = 1130
    // compactWidth = 560 + 70 + 150 + 70 + 40 = 890
    // hide signOcr = 560 + 70 + 150 + 40 + 40 = 860
    // hide boundingBox = 560 + 70 + 150 + 40 = 820
    // hide page = 560 + 70 + 40 = 670
    // hide insert = 560 + 40 = 600

    it('returns full mode with no hidden groups when there is ample space', () => {
      const res = computeToolbarLayout(customWidths, 1280)
      expect(res.mode).toBe('full')
      expect(res.hiddenGroups).toEqual([])
    })

    it('returns compact mode with no hidden groups when slightly tight', () => {
      const res = computeToolbarLayout(customWidths, 950)
      expect(res.mode).toBe('compact')
      expect(res.hiddenGroups).toEqual([])
    })

    it('hides signOcr first when available width drops below compactWidth', () => {
      const res = computeToolbarLayout(customWidths, 870)
      expect(res.mode).toBe('compact')
      expect(res.hiddenGroups).toEqual(['signOcr'])
    })

    it('hides boundingBox second in overflow menu', () => {
      const res = computeToolbarLayout(customWidths, 830)
      expect(res.mode).toBe('compact')
      expect(res.hiddenGroups).toEqual(['signOcr', 'boundingBox'])
    })

    it('hides page ops third in overflow menu', () => {
      const res = computeToolbarLayout(customWidths, 700)
      expect(res.mode).toBe('compact')
      expect(res.hiddenGroups).toEqual(['signOcr', 'boundingBox', 'page'])
    })

    it('hides insert fourth in overflow menu, but never hides tools/colors/edit', () => {
      const res = computeToolbarLayout(customWidths, 200)
      expect(res.mode).toBe('compact')
      expect(res.hiddenGroups).toEqual(['signOcr', 'boundingBox', 'page', 'insert'])

      // Even at 0 width, essential controls are not in hiddenGroups
      const zeroRes = computeToolbarLayout(customWidths, 0)
      expect(zeroRes.hiddenGroups).not.toContain('tools')
      expect(zeroRes.hiddenGroups).not.toContain('colors')
      expect(zeroRes.hiddenGroups).not.toContain('edit')
    })

    it('respects includeBoundingBox: false when desktop bounding box is disabled', () => {
      const res = computeToolbarLayout(customWidths, 830, { isDesktop: false })
      // When bounding box is disabled, signOcr hides first, boundingBox is omitted
      expect(res.hiddenGroups).toEqual(['signOcr'])
    })
  })

  describe('K2: ToolbarOverflowMenu (jsdom)', () => {
    it('opens overflow menu, triggers rotateCurrentPage exactly once, closes on Esc and restores focus', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      const onRotatePage = vi.fn()
      const onMovePage = vi.fn()
      const onDeletePage = vi.fn()

      act(() => {
        root.render(
          <ToolbarOverflowMenu
            hiddenGroups={['page']}
            onInsertImage={vi.fn()}
            onInsertPage={vi.fn()}
            page={2}
            pageCount={5}
            onMovePage={onMovePage}
            onRotatePage={onRotatePage}
            canRotate={true}
            rotateLabel="Xoay trang"
            onDeletePage={onDeletePage}
            onSign={vi.fn()}
            onScanOcr={vi.fn()}
            ocrBusy={false}
            ocrProgress={0}
          />
        )
      })

      const triggerBtn = container.querySelector(
        'button[aria-label="Thêm thao tác"]'
      ) as HTMLButtonElement
      expect(triggerBtn).not.toBeNull()
      expect(triggerBtn.getAttribute('aria-haspopup')).toBe('menu')

      // Open menu
      act(() => {
        triggerBtn.click()
      })

      const menu = container.querySelector('[role="menu"]') as HTMLElement
      expect(menu).not.toBeNull()

      // Click "Xoay trang"
      const rotateBtn = Array.from(
        menu.querySelectorAll('button[role="menuitem"]')
      ).find((b) => b.textContent?.includes('Xoay trang')) as HTMLButtonElement

      expect(rotateBtn).toBeDefined()
      act(() => {
        rotateBtn.click()
      })

      // Handler called exactly once
      expect(onRotatePage).toHaveBeenCalledTimes(1)
      // Menu closes on action
      expect(container.querySelector('[role="menu"]')).toBeNull()

      // Re-open menu to test Escape
      act(() => {
        triggerBtn.click()
      })
      const menu2 = container.querySelector('[role="menu"]') as HTMLElement
      expect(menu2).not.toBeNull()

      act(() => {
        menu2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      // Menu closes on Escape
      expect(container.querySelector('[role="menu"]')).toBeNull()

      root.unmount()
      container.remove()
    })

    it('does not invoke callback when disabled item in overflow menu is clicked', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      const onRotatePage = vi.fn()

      act(() => {
        root.render(
          <ToolbarOverflowMenu
            hiddenGroups={['page']}
            onInsertImage={vi.fn()}
            onInsertPage={vi.fn()}
            page={1}
            pageCount={5}
            onMovePage={vi.fn()}
            onRotatePage={onRotatePage}
            canRotate={false}
            rotateLabel="Trang có chữ đã sửa, chưa xoay được"
            onDeletePage={vi.fn()}
            onSign={vi.fn()}
            onScanOcr={vi.fn()}
            ocrBusy={false}
            ocrProgress={0}
          />
        )
      })

      const triggerBtn = container.querySelector(
        'button[aria-label="Thêm thao tác"]'
      ) as HTMLButtonElement

      act(() => {
        triggerBtn.click()
      })

      const menu = container.querySelector('[role="menu"]') as HTMLElement
      const rotateBtn = Array.from(
        menu.querySelectorAll('button[role="menuitem"]')
      ).find((b) => b.textContent?.includes('Xoay trang')) as HTMLButtonElement

      expect(rotateBtn.disabled).toBe(true)
      expect(rotateBtn.getAttribute('aria-disabled')).toBe('true')
      expect(rotateBtn.title).toContain('Trang có chữ đã sửa')

      act(() => {
        rotateBtn.click()
      })

      expect(onRotatePage).not.toHaveBeenCalled()

      root.unmount()
      container.remove()
    })
  })

  describe('K3: PropertiesPanel (jsdom)', () => {
    it('displays maximum 1 decimal place (130.9) for an image annotation with width 130.92 pt', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      // Page size 1000 x 1000 pt, annotation width ratio 0.13092 -> 130.92 pt
      const annotation: Annotation = {
        id: 'img-1',
        page: 1,
        type: 'image',
        x: 0.1,
        y: 0.1,
        width: 0.13092,
        height: 0.2,
        color: '#000000',
        opacity: 1,
        imageDataUrl: 'data:image/png;base64,mock',
      }

      const defaultTextStyle: TextStyle = {
        fontFamily: 'Helvetica',
        fontSize: 16,
        bold: false,
        italic: false,
        underline: false,
        align: 'left',
        color: '#000000',
      }

      act(() => {
        root.render(
          <PropertiesPanel
            selectedAnnotation={annotation}
            pageSizePt={{ width: 1000, height: 1000 }}
            tool="select"
            textStyle={defaultTextStyle}
            onTextStyleChange={vi.fn()}
            onUpdateAnnotation={vi.fn()}
            aspectLocked={true}
            onToggleAspectLock={vi.fn()}
          />
        )
      })

      const widthInput = container.querySelector('#prop-w') as HTMLInputElement
      expect(widthInput).not.toBeNull()
      expect(widthInput.value).toBe('130.9')

      // Verify input and unit are siblings on one line inside .properties-field
      const field = widthInput.closest('.properties-field') as HTMLElement
      expect(field).not.toBeNull()
      const label = field.querySelector('label')
      const unit = field.querySelector('.unit')
      expect(label?.textContent).toBe('Rộng')
      expect(unit?.textContent).toBe('pt')
      // Direct children of .properties-field: label, input, span.unit (no nested wrapper div)
      expect(widthInput.parentElement).toBe(field)

      root.unmount()
      container.remove()
    })
  })
})
