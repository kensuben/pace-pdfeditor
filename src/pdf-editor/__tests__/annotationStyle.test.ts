import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../types'
import { annotationFill, draftRect } from '../annotationStyle'

describe('F-13: annotationStyle suite', () => {
  describe('K1: annotationFill', () => {
    it('returns color for highlight annotation', () => {
      const hl: Annotation = {
        id: 'hl-1',
        page: 1,
        type: 'highlight',
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.05,
        color: '#F5C84C',
        opacity: 0.38,
      }
      expect(annotationFill(hl)).toBe('#F5C84C')
    })

    it('returns undefined for text, draw, and image annotations', () => {
      const textAnn: Annotation = {
        id: 'text-1',
        page: 1,
        type: 'text',
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.05,
        color: '#E85D3F',
        opacity: 1,
        text: 'Sample text',
      }
      const drawAnn: Annotation = {
        id: 'draw-1',
        page: 1,
        type: 'draw',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        color: '#1F252B',
        opacity: 1,
        points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      }
      const imgAnn: Annotation = {
        id: 'img-1',
        page: 1,
        type: 'image',
        x: 0.2,
        y: 0.3,
        width: 0.4,
        height: 0.3,
        color: '#000000',
        opacity: 1,
        imageDataUrl: 'data:image/png;base64,...',
      }

      expect(annotationFill(textAnn)).toBeUndefined()
      expect(annotationFill(drawAnn)).toBeUndefined()
      expect(annotationFill(imgAnn)).toBeUndefined()
    })
  })

  describe('K2: draftRect', () => {
    it('normalizes (0.5, 0.5) -> (0.2, 0.3) to { x: 0.2, y: 0.3, width: 0.3, height: 0.2 }', () => {
      const r = draftRect({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 })
      expect(r.x).toBeCloseTo(0.2, 6)
      expect(r.y).toBeCloseTo(0.3, 6)
      expect(r.width).toBeCloseTo(0.3, 6)
      expect(r.height).toBeCloseTo(0.2, 6)
    })

    it('clamps coordinates outside [0, 1] range', () => {
      const r = draftRect({ x: -0.2, y: 1.5 }, { x: 0.4, y: 0.8 })
      expect(r.x).toBeCloseTo(0, 6)
      expect(r.y).toBeCloseTo(0.8, 6)
      expect(r.width).toBeCloseTo(0.4, 6)
      expect(r.height).toBeCloseTo(0.2, 6)
    })

    it('returns width = height = 0 for identical start and end points', () => {
      const pt = { x: 0.35, y: 0.65 }
      const r = draftRect(pt, pt)
      expect(r.x).toBeCloseTo(0.35, 6)
      expect(r.y).toBeCloseTo(0.65, 6)
      expect(r.width).toBe(0)
      expect(r.height).toBe(0)
    })
  })
})
