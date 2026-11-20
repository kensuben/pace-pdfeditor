import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../types'
import {
  getBounds,
  moveBy,
  resizeFromHandle,
  nudgeDelta,
  imageInsertSize,
} from '../selection/geometry'

describe('W-8 Selection & Geometry Suite', () => {
  describe('K1: getBounds and moveBy', () => {
    it('calculates correct bounding box for a 3-point stroke', () => {
      const stroke: Annotation = {
        id: 'stroke-1',
        page: 1,
        type: 'draw',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        color: '#ff0000',
        opacity: 1,
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.5, y: 0.1 },
          { x: 0.7, y: 0.6 },
        ],
      }

      const bounds = getBounds(stroke)
      expect(bounds.x).toBeCloseTo(0.2, 5)
      expect(bounds.y).toBeCloseTo(0.1, 5)
      expect(bounds.width).toBeCloseTo(0.5, 5)
      expect(bounds.height).toBeCloseTo(0.5, 5)
    })

    it('clamps moveBy so bounding box hits right edge at exactly 1.0', () => {
      const rect: Annotation = {
        id: 'box-1',
        page: 1,
        type: 'text',
        x: 0.8,
        y: 0.2,
        width: 0.3,
        height: 0.2,
        color: '#000000',
        opacity: 1,
      }

      const moved = moveBy(rect, 0.15, 0)
      expect(moved.x + moved.width).toBeCloseTo(1.0, 5)
      expect(moved.x).toBeCloseTo(0.7, 5)
      expect(moved.width).toBeCloseTo(0.3, 5)
    })

    it('increases x and y correctly for highlight moveBy(0.1, 0.05)', () => {
      const hl: Annotation = {
        id: 'hl-1',
        page: 1,
        type: 'highlight',
        x: 0.2,
        y: 0.3,
        width: 0.4,
        height: 0.1,
        color: '#ffff00',
        opacity: 0.38,
      }

      const moved = moveBy(hl, 0.1, 0.05)
      expect(moved.x).toBeCloseTo(0.3, 5)
      expect(moved.y).toBeCloseTo(0.35, 5)
      expect(moved.width).toBeCloseTo(0.4, 5)
      expect(moved.height).toBeCloseTo(0.1, 5)
    })
  })

  describe('K2: resizeFromHandle', () => {
    const baseBox: Annotation = {
      id: 'box-2',
      page: 1,
      type: 'text',
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.3,
      color: '#000000',
      opacity: 1,
    }

    it('se +0.1/+0.1 increases width and height by 0.1 while x and y remain fixed', () => {
      const resized = resizeFromHandle(baseBox, 'se', 0.1, 0.1, {
        keepAspect: false,
        minSize: { w: 0.01, h: 0.01 },
      })
      expect(resized.x).toBeCloseTo(0.2, 5)
      expect(resized.y).toBeCloseTo(0.2, 5)
      expect(resized.width).toBeCloseTo(0.4, 5)
      expect(resized.height).toBeCloseTo(0.4, 5)
    })

    it('nw +0.1/+0.1 increases x and y by 0.1 while width and height decrease by 0.1', () => {
      const resized = resizeFromHandle(baseBox, 'nw', 0.1, 0.1, {
        keepAspect: false,
        minSize: { w: 0.01, h: 0.01 },
      })
      expect(resized.x).toBeCloseTo(0.3, 5)
      expect(resized.y).toBeCloseTo(0.3, 5)
      expect(resized.width).toBeCloseTo(0.2, 5)
      expect(resized.height).toBeCloseTo(0.2, 5)
    })

    it('clamps to minSize and prevents negative dimensions when dragged too small', () => {
      const resized = resizeFromHandle(baseBox, 'se', -0.5, -0.5, {
        keepAspect: false,
        minSize: { w: 0.05, h: 0.06 },
      })
      expect(resized.width).toBeCloseTo(0.05, 5)
      expect(resized.height).toBeCloseTo(0.06, 5)
      expect(resized.width).toBeGreaterThanOrEqual(0.05)
      expect(resized.height).toBeGreaterThanOrEqual(0.06)
    })

    it('keepAspect at corner handle se on 2:1 image preserves 2:1 ratio (error <= 1e-6)', () => {
      const img: Annotation = {
        id: 'img-1',
        page: 1,
        type: 'image',
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.2,
        color: '#000000',
        opacity: 1,
      }

      const resized = resizeFromHandle(img, 'se', 0.1, 0, {
        keepAspect: true,
        minSize: { w: 0.01, h: 0.01 },
      })
      const ratio = resized.width / resized.height
      expect(Math.abs(ratio - 2.0)).toBeLessThanOrEqual(1e-6)
    })

    it('side handle e is NOT affected by keepAspect', () => {
      const img: Annotation = {
        id: 'img-2',
        page: 1,
        type: 'image',
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.2,
        color: '#000000',
        opacity: 1,
      }

      const resized = resizeFromHandle(img, 'e', 0.1, 0, {
        keepAspect: true,
        minSize: { w: 0.01, h: 0.01 },
      })
      expect(resized.width).toBeCloseTo(0.5, 5)
      expect(resized.height).toBeCloseTo(0.2, 5)
    })

    it('stroke resized x2 around corner nw doubles distance from that corner', () => {
      const stroke: Annotation = {
        id: 'stroke-2',
        page: 1,
        type: 'draw',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        color: '#000000',
        opacity: 1,
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.3, y: 0.4 },
          { x: 0.4, y: 0.3 },
        ],
      }

      const b = getBounds(stroke) // x: 0.2, y: 0.2, w: 0.2, h: 0.2
      const resized = resizeFromHandle(stroke, 'se', b.width, b.height, {
        keepAspect: false,
        minSize: { w: 0.01, h: 0.01 },
      })

      expect(resized.points).toBeDefined()
      const pts = resized.points!
      const nw = { x: b.x, y: b.y }

      for (let i = 0; i < stroke.points!.length; i++) {
        const origDistX = stroke.points![i].x - nw.x
        const origDistY = stroke.points![i].y - nw.y
        const newDistX = pts[i].x - nw.x
        const newDistY = pts[i].y - nw.y

        expect(newDistX).toBeCloseTo(origDistX * 2, 5)
        expect(newDistY).toBeCloseTo(origDistY * 2, 5)
      }
    })
  })

  describe('K3: nudgeDelta', () => {
    it('calculates 1 pt step for ArrowRight on 600x800 page as dx = 1/600', () => {
      const delta = nudgeDelta({ width: 600, height: 800 }, 1, 'ArrowRight')
      expect(delta.dx).toBeCloseTo(1 / 600, 7)
      expect(delta.dy).toBe(0)
    })

    it('calculates Shift (10 pt) step for ArrowDown on 600x800 page as dy = 10/800', () => {
      const delta = nudgeDelta({ width: 600, height: 800 }, 10, 'ArrowDown')
      expect(delta.dx).toBe(0)
      expect(delta.dy).toBeCloseTo(10 / 800, 7)
    })
  })

  describe('K4: imageInsertSize', () => {
    it('calculates dimensions for 400x200 px image on vertical 595x842 page', () => {
      const size = imageInsertSize({ w: 400, h: 200 }, { width: 595, height: 842 })
      const expectedHeight = 0.28 * 595 * (200 / 400) / 842
      expect(size.width).toBeCloseTo(0.28, 6)
      expect(Math.abs(size.height - expectedHeight)).toBeLessThanOrEqual(1e-6)
    })

    it('maintains correct physical pt aspect ratio 2:1 on landscape 842x595 page', () => {
      const size = imageInsertSize({ w: 400, h: 200 }, { width: 842, height: 595 })
      const ptWidth = size.width * 842
      const ptHeight = size.height * 595
      const aspectPt = ptWidth / ptHeight
      expect(Math.abs(aspectPt - 2.0)).toBeLessThanOrEqual(1e-6)
    })

    it('caps height at 0.35 and proportionally reduces width for very tall image', () => {
      const size = imageInsertSize({ w: 100, h: 500 }, { width: 595, height: 842 })
      expect(size.height).toBeCloseTo(0.35, 6)
      expect(size.width).toBeLessThan(0.28)
      // Check physical aspect ratio is preserved:
      const ptWidth = size.width * 595
      const ptHeight = size.height * 842
      expect(Math.abs(ptWidth / ptHeight - 100 / 500)).toBeLessThanOrEqual(1e-6)
    })
  })
})
