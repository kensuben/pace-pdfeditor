// @vitest-environment jsdom
if (typeof DOMMatrix === 'undefined') {
  // @ts-expect-error polyfill for jsdom
  globalThis.DOMMatrix = class DOMMatrix {}
}

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import { computeSnap } from '../selection/snap'
import { anchorScrollDelta, SIDEBAR_OVERLAY_MAX_WIDTH, defaultAspectLockedForType } from '../viewMath'
import { applyPanelDimensions } from '../selection/geometry'
import { buildEditedPdf } from '../exportPdf'
import { PropertiesPanel } from '../PropertiesPanel'
import type { Annotation } from '../../types'
import type * as pdfjs from 'pdfjs-dist'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let PdfCanvasComponent: typeof import('../PdfCanvas').PdfCanvas

beforeAll(async () => {
  if (typeof DOMMatrix === 'undefined') {
    // @ts-expect-error polyfill for jsdom
    globalThis.DOMMatrix = class DOMMatrix {}
  }
  const mod = await import('../PdfCanvas')
  PdfCanvasComponent = mod.PdfCanvas
})

describe('W-8b: Properties Panel, Snapping Guides, Bounding Box Toggle, Polish Suite', () => {
  describe('K1: computeSnap', () => {
    it('snaps to candidate left edge when within threshold (dist 0.003 <= 0.005) with vertical guide', () => {
      // Candidate at x = 0.1, target rect at x = 0.103 (diff = -0.003)
      const rect = { x: 0.103, y: 0.2, width: 0.1, height: 0.1 }
      const candidates = [{ x: 0.1, y: 0.5, width: 0.1, height: 0.1 }]
      const res = computeSnap(rect, candidates, 0.005)

      expect(res.dx).toBeCloseTo(-0.003, 5)
      expect(rect.x + res.dx).toBeCloseTo(0.1, 5)
      expect(res.guides).toHaveLength(1)
      expect(res.guides[0]).toEqual({
        orientation: 'vertical',
        position: 0.1,
      })
    })

    it('does not snap when distance exceeds threshold (dist 0.01 > 0.005)', () => {
      const rect = { x: 0.11, y: 0.2, width: 0.1, height: 0.1 }
      const candidates = [{ x: 0.1, y: 0.5, width: 0.1, height: 0.1 }]
      const res = computeSnap(rect, candidates, 0.005)

      expect(res.dx).toBe(0)
      expect(res.dy).toBe(0)
      expect(res.guides).toHaveLength(0)
    })

    it('snaps horizontal center to page center line (0.5) when close', () => {
      // Center of rect = 0.44 + 0.1 / 2 = 0.49. Diff to 0.5 is +0.01
      const rect = { x: 0.44, y: 0.2, width: 0.1, height: 0.1 }
      const candidates: { x: number; y: number; width: number; height: number }[] = []
      const res = computeSnap(rect, candidates, 0.02)

      expect(res.dx).toBeCloseTo(0.01, 5)
      expect(rect.x + rect.width / 2 + res.dx).toBeCloseTo(0.5, 5)
      expect(res.guides).toContainEqual({
        orientation: 'vertical',
        position: 0.5,
      })
    })
  })

  describe('K2: anchorScrollDelta', () => {
    it('keeps pointer point stationary under pointer with error <= 0.5px', () => {
      const beforeRect = { left: 100, top: 50, width: 595, height: 842 }
      const afterRect = { left: 70, top: 20, width: 654.5, height: 926.2 }
      const pointer = { x: 400, y: 300 }

      const fx = (pointer.x - beforeRect.left) / beforeRect.width
      const fy = (pointer.y - beforeRect.top) / beforeRect.height

      const { deltaX, deltaY } = anchorScrollDelta(beforeRect, afterRect, fx, fy, pointer)

      // In the new layout, screen position before adjustment:
      const beforeAdjustX = afterRect.left + fx * afterRect.width
      const beforeAdjustY = afterRect.top + fy * afterRect.height

      // After applying delta scroll (container.scroll += delta), element on screen moves by -delta:
      const finalScreenX = beforeAdjustX - deltaX
      const finalScreenY = beforeAdjustY - deltaY

      expect(Math.abs(finalScreenX - pointer.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(finalScreenY - pointer.y)).toBeLessThanOrEqual(0.5)
      expect(finalScreenX).toBeCloseTo(400, 3)
      expect(finalScreenY).toBeCloseTo(300, 3)
    })
  })

  describe('K3: applyPanelDimensions with aspect ratio locking', () => {
    const pageSizePt = { width: 500, height: 500 }
    const image2to1: Annotation = {
      id: 'img-1',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.4, // 200 pt
      height: 0.2, // 100 pt
      color: '#000000',
      opacity: 1,
    }

    it('when aspect ratio is locked: editing W changes H = W/2', () => {
      // 200 pt : 100 pt -> ratio 2:1. Changing W to 300 pt gives H = 150 pt
      const updated = applyPanelDimensions(
        image2to1,
        { widthPt: 300, keepAspect: true },
        pageSizePt,
      )

      const resultingWPt = updated.width * pageSizePt.width
      const resultingHPt = updated.height * pageSizePt.height

      expect(resultingWPt).toBeCloseTo(300, 2)
      expect(resultingHPt).toBeCloseTo(150, 2)
      expect(resultingHPt).toBeCloseTo(resultingWPt / 2, 2)
    })

    it('when aspect ratio is unlocked: editing W keeps H unchanged', () => {
      const updated = applyPanelDimensions(
        image2to1,
        { widthPt: 300, keepAspect: false },
        pageSizePt,
      )

      const resultingWPt = updated.width * pageSizePt.width
      const resultingHPt = updated.height * pageSizePt.height

      expect(resultingWPt).toBeCloseTo(300, 2)
      expect(resultingHPt).toBeCloseTo(100, 2) // Unchanged
    })

    it('scales points for draw/signature annotations when dimensions change', () => {
      const drawAnn: Annotation = {
        id: 'draw-1',
        page: 1,
        type: 'draw',
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        color: '#ff0000',
        opacity: 0.8,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.3, y: 0.3 },
        ],
      }

      const updated = applyPanelDimensions(
        drawAnn,
        { widthPt: 200, heightPt: 200 }, // scale 2x from 100pt to 200pt
        pageSizePt,
      )

      expect(updated.points).toBeDefined()
      expect(updated.points![0]).toEqual({ x: 0.1, y: 0.1 })
      expect(updated.points![1].x).toBeCloseTo(0.5, 3)
      expect(updated.points![1].y).toBeCloseTo(0.5, 3)
    })
  })

  describe('K4: exportPdf highlight with BlendMode.Multiply', () => {
    it('creates ExtGState with /BM /Multiply in exported PDF for highlight annotation', async () => {
      // Create empty 1-page PDF
      const srcDoc = await PDFDocument.create()
      srcDoc.addPage([600, 800])
      const pdfBytes = await srcDoc.save()

      const highlightAnn: Annotation = {
        id: 'hl-1',
        page: 1,
        type: 'highlight',
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.05,
        color: '#ffeb3b',
        opacity: 0.38,
      }

      const exportedBytes = await buildEditedPdf(pdfBytes, [highlightAnn])
      expect(exportedBytes).toBeInstanceOf(Uint8Array)
      expect(exportedBytes.length).toBeGreaterThan(0)

      // Load exported PDF and verify ExtGState with /Multiply
      const outDoc = await PDFDocument.load(exportedBytes)
      const page = outDoc.getPage(0)
      const resources = page.node.Resources()
      expect(resources).toBeDefined()

      const extGState = resources?.lookup(PDFName.of('ExtGState'), PDFDict)
      expect(extGState).toBeDefined()

      let foundMultiply = false
      if (extGState) {
        for (const [, val] of extGState.entries()) {
          const dict = outDoc.context.lookup(val, PDFDict)
          if (dict) {
            const bm = dict.get(PDFName.of('BM'))
            if (bm && bm.toString().includes('Multiply')) {
              foundMultiply = true
              break
            }
          }
        }
      }
      expect(foundMultiply).toBe(true)
    })
  })

  describe('K5 & Polish: Constants & Navigation', () => {
    it('exports SIDEBAR_OVERLAY_MAX_WIDTH as 800 matching CSS media query', () => {
      expect(SIDEBAR_OVERLAY_MAX_WIDTH).toBe(800)
    })
  })

  // ==========================================
  // W-8b2 QA Fixes: T1 - T4 Regression Tests
  // ==========================================
  describe('W-8b2 QA Tests: T1 - T4', () => {
    describe('T1 (jsdom): PdfCanvas image opacity matching exported PDF', () => {
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

      it('renders image annotation with style opacity matching display.opacity (0.5)', () => {
        const mockPdf = {
          getPage: vi.fn().mockResolvedValue({
            getViewport: () => ({ width: 600, height: 800 }),
            render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
            getTextContent: () => Promise.resolve({ items: [] }),
          }),
        } as unknown as pdfjs.PDFDocumentProxy

        const imageAnn: Annotation = {
          id: 'img-opacity-50',
          page: 1,
          type: 'image',
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.2,
          imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          opacity: 0.5,
          color: '#000000',
        }

        act(() => {
          root.render(
            <PdfCanvasComponent
              pdf={mockPdf}
              pageNumber={1}
              zoom={1}
              annotations={[imageAnn]}
              tool="select"
              color="#000000"
              onAdd={vi.fn()}
              onUpdate={vi.fn()}
              selectedId={null}
              onSelect={vi.fn()}
              textRegions={[]}
              onTextRegions={vi.fn()}
              onEditRegion={vi.fn()}
              onEditAnnotation={vi.fn()}
            />
          )
        })

        const img = container.querySelector<HTMLImageElement>('img.image-annotation')
        expect(img).not.toBeNull()
        expect(img?.style.opacity).toBe('0.5')
      })
    })

    describe('T2 (logic/pure & state): aspectLocked transitions', () => {
      it('returns true for image, false for text, and preserves aspectLocked on image insert/select', () => {
        // 1. Pure helper function checks
        expect(defaultAspectLockedForType('image')).toBe(true)
        expect(defaultAspectLockedForType('text')).toBe(false)
        expect(defaultAspectLockedForType('highlight')).toBe(false)
        expect(defaultAspectLockedForType('draw')).toBe(false)
        expect(defaultAspectLockedForType(undefined)).toBe(false)

        // 2. Selection transition flow
        interface EditorState {
          selectedId: string | null
          aspectLocked: boolean
          annotations: Annotation[]
        }

        let state: EditorState = {
          selectedId: null,
          aspectLocked: false,
          annotations: [
            { id: 'img-1', page: 1, type: 'image', x: 0.1, y: 0.1, width: 0.2, height: 0.2, color: '#000', opacity: 1 },
            { id: 'txt-1', page: 1, type: 'text', x: 0.3, y: 0.3, width: 0.2, height: 0.1, color: '#000', opacity: 1, text: 'Sample' },
          ],
        }

        const selectAnnotation = (id: string | null) => {
          const selected = state.annotations.find((a) => a.id === id)
          state = {
            ...state,
            selectedId: id,
            aspectLocked: defaultAspectLockedForType(selected?.type),
          }
        }

        const insertImage = (img: Annotation) => {
          state = {
            ...state,
            annotations: [...state.annotations, img],
          }
          selectAnnotation(img.id)
        }

        // Action 1: Select image -> aspectLocked = true
        selectAnnotation('img-1')
        expect(state.selectedId).toBe('img-1')
        expect(state.aspectLocked).toBe(true)

        // Action 2: Select text box -> aspectLocked = false
        selectAnnotation('txt-1')
        expect(state.selectedId).toBe('txt-1')
        expect(state.aspectLocked).toBe(false)

        // Action 3: Insert new image -> aspectLocked = true
        const newImg: Annotation = {
          id: 'img-new-2',
          page: 1,
          type: 'image',
          x: 0.2,
          y: 0.2,
          width: 0.3,
          height: 0.15,
          color: '#000',
          opacity: 1,
        }
        insertImage(newImg)
        expect(state.selectedId).toBe('img-new-2')
        expect(state.aspectLocked).toBe(true)
      })
    })

    describe('T3 (component): PropertiesPanel text box renders position, size, opacity and font inputs', () => {
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

      it('renders prop-x, prop-w, prop-opacity, and font selector for a regular text box', () => {
        const textAnn: Annotation = {
          id: 'tb-test-1',
          page: 1,
          type: 'text',
          x: 0.15,
          y: 0.25,
          width: 0.3,
          height: 0.08,
          text: 'Văn bản thử nghiệm',
          fontFamily: 'Helvetica',
          fontSize: 16,
          color: '#0c2340',
          opacity: 0.85,
        }

        act(() => {
          root.render(
            <PropertiesPanel
              selectedAnnotation={textAnn}
              pageSizePt={{ width: 612, height: 792 }}
              tool="select"
              textStyle={{
                fontFamily: 'Helvetica',
                fontSize: 16,
                bold: false,
                italic: false,
                underline: false,
                align: 'left',
                color: '#0c2340',
              }}
              onTextStyleChange={vi.fn()}
              onUpdateAnnotation={vi.fn()}
              aspectLocked={false}
              onToggleAspectLock={vi.fn()}
            />
          )
        })

        // Section Vị trí & Kích thước
        const propX = container.querySelector<HTMLInputElement>('#prop-x')
        const propY = container.querySelector<HTMLInputElement>('#prop-y')
        const propW = container.querySelector<HTMLInputElement>('#prop-w')
        const propH = container.querySelector<HTMLInputElement>('#prop-h')
        expect(propX).not.toBeNull()
        expect(propY).not.toBeNull()
        expect(propW).not.toBeNull()
        expect(propH).not.toBeNull()

        // Section Độ mờ
        const propOpacity = container.querySelector<HTMLInputElement>('#prop-opacity')
        expect(propOpacity).not.toBeNull()
        expect(propOpacity?.value).toBe('85')

        // Section Định dạng chữ (TextFormatBar)
        const fontSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Font chữ"]')
        expect(fontSelect).not.toBeNull()
        expect(fontSelect?.value).toBe('Helvetica')
      })
    })

    describe('T4 (viewMath / DOM): anchorScrollDelta with page wider than viewport', () => {
      it('restores pointer client coordinates within <= 0.5px after scrollLeft adjustment', () => {
        // Viewport width = 600, container scrollable horizontally
        const pointer = { x: 350, y: 250 }

        // Before zoom: page width = 700 (> 600 viewport), centered/scrolled at left = -50
        const beforeRect = { left: -50, top: 20, width: 700, height: 900 }
        const fx = (pointer.x - beforeRect.left) / beforeRect.width // (350 - (-50)) / 700 = 400 / 700
        const fy = (pointer.y - beforeRect.top) / beforeRect.height

        // Zoom in to 1.5x: page width becomes 1050 (> 600 viewport)
        // DOM layout positions page at afterRect before scroll adjustment
        const afterRect = { left: -75, top: 10, width: 1050, height: 1350 }

        const { deltaX, deltaY } = anchorScrollDelta(beforeRect, afterRect, fx, fy, pointer)

        // When deltaX is added to container.scrollLeft, the page elements shift left by deltaX on screen:
        const finalClientX = afterRect.left - deltaX + fx * afterRect.width
        const finalClientY = afterRect.top - deltaY + fy * afterRect.height

        expect(Math.abs(finalClientX - pointer.x)).toBeLessThanOrEqual(0.5)
        expect(Math.abs(finalClientY - pointer.y)).toBeLessThanOrEqual(0.5)
        expect(finalClientX).toBeCloseTo(pointer.x, 4)
        expect(finalClientY).toBeCloseTo(pointer.y, 4)
      })

      it('simulates actual DOM scroll container wider than viewport with scrollLeft adjustment', () => {
        // Simulated scroll container
        const container = document.createElement('div')
        Object.defineProperty(container, 'clientWidth', { value: 600 })
        Object.defineProperty(container, 'scrollWidth', { value: 1200 })
        let currentScrollLeft = 100
        Object.defineProperty(container, 'scrollLeft', {
          get: () => currentScrollLeft,
          set: (val: number) => {
            currentScrollLeft = Math.max(0, Math.min(600, val))
          },
        })

        const pointer = { x: 280, y: 200 }
        const beforeRect = { left: 40, top: 20, width: 800, height: 1000 }
        const fx = (pointer.x - beforeRect.left) / beforeRect.width
        const fy = (pointer.y - beforeRect.top) / beforeRect.height

        // After zoom: width = 1000
        const afterRect = { left: 50, top: 15, width: 1000, height: 1250 }
        const { deltaX } = anchorScrollDelta(beforeRect, afterRect, fx, fy, pointer)

        container.scrollLeft += deltaX

        // In real layout, new screen position of element = afterRect.left - (newScroll - oldScroll)
        const scrollApplied = currentScrollLeft - 100
        const finalAnchorX = (afterRect.left - scrollApplied) + fx * afterRect.width
        expect(Math.abs(finalAnchorX - pointer.x)).toBeLessThanOrEqual(0.5)
      })
    })
  })
})
