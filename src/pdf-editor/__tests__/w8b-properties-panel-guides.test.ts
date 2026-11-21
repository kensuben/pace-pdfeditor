import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import { computeSnap } from '../selection/snap'
import { anchorScrollDelta, SIDEBAR_OVERLAY_MAX_WIDTH } from '../viewMath'
import { applyPanelDimensions } from '../selection/geometry'
import { buildEditedPdf } from '../exportPdf'
import type { Annotation } from '../../types'

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
})
