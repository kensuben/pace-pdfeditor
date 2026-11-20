// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../types'
import {
  FIT_PADDING,
  canRotatePage,
  fitZoom,
  pickCurrentPage,
  resetHistoryOnPageOp,
  rotateAnnotationsCw,
  zoomAroundPoint,
} from '../viewMath'

describe('viewMath Unit Tests (W-11 K1–K4, K6, canRotatePage)', () => {
  it('K1: pickCurrentPage returns page with largest visible area, or fallback when all 0', () => {
    // [0, 120, 300, 40] -> page 3 (index 2)
    const areas = [0, 120, 300, 40]
    expect(pickCurrentPage(areas, 1)).toBe(3)

    // All zero -> keep current page
    expect(pickCurrentPage([0, 0, 0, 0], 2)).toBe(2)
    expect(pickCurrentPage([], 4)).toBe(4)

    // Objects format
    const objAreas = [
      { page: 1, area: 0 },
      { page: 2, area: 120 },
      { page: 3, area: 300 },
      { page: 4, area: 40 },
    ]
    expect(pickCurrentPage(objAreas, 1)).toBe(3)
    expect(
      pickCurrentPage(
        [
          { page: 1, area: 0 },
          { page: 2, area: 0 },
        ],
        2,
      ),
    ).toBe(2)
  })

  it('K2: fitZoom computes width and page zoom correctly using FIT_PADDING and clamps 0.25-4', () => {
    const container = { width: 1000, height: 700 }
    const page = { width: 600, height: 800 }

    const expectedWidth = (1000 - FIT_PADDING) / 600
    const expectedPage = Math.min((1000 - FIT_PADDING) / 600, (700 - FIT_PADDING) / 800)

    expect(fitZoom(container, page, 'width')).toBeCloseTo(expectedWidth, 5)
    expect(fitZoom(container, page, 'page')).toBeCloseTo(expectedPage, 5)

    // Clamping to [0.25, 4]
    expect(fitZoom({ width: 10000, height: 10000 }, page, 'width')).toBe(4)
    expect(fitZoom({ width: 10, height: 10 }, page, 'width')).toBe(0.25)
  })

  it('K3: zoomAroundPoint keeps content point under pointer stationary (error <= 0.5px)', () => {
    const currentZoom = 1.0
    const nextZoom = 1.1
    const pointer = { x: 400, y: 300 }
    const scroll = { left: 150, top: 220 }

    // Content position under pointer before zoom:
    const contentX = (scroll.left + pointer.x) / currentZoom
    const contentY = (scroll.top + pointer.y) / currentZoom

    const result = zoomAroundPoint({
      currentZoom,
      nextZoom,
      pointer,
      scroll,
    })

    // Content position under pointer after zoom:
    const screenXAfter = contentX * nextZoom - result.nextScrollLeft
    const screenYAfter = contentY * nextZoom - result.nextScrollTop

    expect(Math.abs(screenXAfter - pointer.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(screenYAfter - pointer.y)).toBeLessThanOrEqual(0.5)

    // Positional overload also works
    const result2 = zoomAroundPoint(currentZoom, nextZoom, pointer, scroll)
    expect(result2.scrollLeft).toBeCloseTo(result.nextScrollLeft, 5)
    expect(result2.scrollTop).toBeCloseTo(result.nextScrollTop, 5)
  })

  it('K4: rotateAnnotationsCw transforms highlight, points, and keeps real pt dimensions for text/image', () => {
    // 1. Highlight: (0.1, 0.2, 0.3, 0.1) -> (0.7, 0.1, 0.1, 0.3)
    const hl: Annotation = {
      id: 'hl-1',
      page: 1,
      type: 'highlight',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.1,
      color: '#F5C84C',
      opacity: 0.38,
    }
    const rotatedHl = rotateAnnotationsCw([hl], 1, { width: 600, height: 400 })[0]
    expect(rotatedHl.x).toBeCloseTo(0.7, 6)
    expect(rotatedHl.y).toBeCloseTo(0.1, 6)
    expect(rotatedHl.width).toBeCloseTo(0.1, 6)
    expect(rotatedHl.height).toBeCloseTo(0.3, 6)

    // 2. Point: (0.1, 0.2) -> (0.8, 0.1)
    const ink: Annotation = {
      id: 'ink-1',
      page: 1,
      type: 'draw',
      x: 0.1,
      y: 0.2,
      width: 0.1,
      height: 0.1,
      color: '#000000',
      opacity: 1,
      points: [{ x: 0.1, y: 0.2 }],
    }
    const rotatedInk = rotateAnnotationsCw([ink], 1, { width: 600, height: 400 })[0]
    expect(rotatedInk.points![0].x).toBeCloseTo(0.8, 6)
    expect(rotatedInk.points![0].y).toBeCloseTo(0.1, 6)

    // 3. 4 consecutive rotations return to original values (error <= 1e-9)
    let currentAnns = [hl, ink]
    let currentView = { width: 600, height: 400 }
    for (let r = 0; r < 4; r++) {
      const nextView = { width: currentView.height, height: currentView.width }
      currentAnns = rotateAnnotationsCw(currentAnns, 1, currentView, nextView)
      currentView = nextView
    }
    expect(Math.abs(currentAnns[0].x - hl.x)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(currentAnns[0].y - hl.y)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(currentAnns[0].width - hl.width)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(currentAnns[0].height - hl.height)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(currentAnns[1].points![0].x - ink.points![0].x)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(currentAnns[1].points![0].y - ink.points![0].y)).toBeLessThanOrEqual(1e-9)

    // 4. Text/Image preserves real pt dimensions on page 600x400 pt (error <= 1e-6)
    const textAnn: Annotation = {
      id: 'txt-1',
      page: 1,
      type: 'text',
      text: 'Test',
      x: 0.2,
      y: 0.3,
      width: 0.2, // 120 pt on 600 pt page
      height: 0.1, // 40 pt on 400 pt page
      color: '#000000',
      opacity: 1,
    }
    const oldViewPt = { width: 600, height: 400 }
    const newViewPt = { width: 400, height: 600 }
    const rotatedText = rotateAnnotationsCw([textAnn], 1, oldViewPt, newViewPt)[0]

    const oldPtW = textAnn.width * oldViewPt.width
    const oldPtH = textAnn.height * oldViewPt.height
    const newPtW = rotatedText.width * newViewPt.width
    const newPtH = rotatedText.height * newViewPt.height

    expect(Math.abs(newPtW - oldPtW)).toBeLessThanOrEqual(1e-6)
    expect(Math.abs(newPtH - oldPtH)).toBeLessThanOrEqual(1e-6)

    // Other pages unaffected
    const page2Ann: Annotation = { ...hl, id: 'hl-p2', page: 2 }
    const res = rotateAnnotationsCw([page2Ann], 1, oldViewPt, newViewPt)
    expect(res[0]).toEqual(page2Ann)
  })

  it('canRotatePage: returns false when page has replaceOriginal annotation, true otherwise', () => {
    const normalText: Annotation = {
      id: 't-1',
      page: 1,
      type: 'text',
      text: 'Hello',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      color: '#000',
      opacity: 1,
    }
    const replaceText: Annotation = {
      ...normalText,
      id: 't-2',
      page: 1,
      replaceOriginal: true,
    }

    // Page 1 with normal annotations -> can rotate
    expect(canRotatePage([normalText], 1)).toBe(true)

    // Page 1 with replaceOriginal -> cannot rotate
    expect(canRotatePage([normalText, replaceText], 1)).toBe(false)

    // Page 2 has replaceOriginal, but checking Page 1 -> can rotate Page 1
    const p2Replace = { ...replaceText, page: 2 }
    expect(canRotatePage([normalText, p2Replace], 1)).toBe(true)
    expect(canRotatePage([normalText, p2Replace], 2)).toBe(false)
  })

  it('K6: resetHistoryOnPageOp sets history to [annotations] and historyIndex to 0', () => {
    const anns: Annotation[] = [
      {
        id: '1',
        page: 1,
        type: 'highlight',
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.1,
        color: '#F5C84C',
        opacity: 0.38,
      },
    ]

    const result = resetHistoryOnPageOp(anns)
    expect(result.historyIndex).toBe(0)
    expect(result.history.length).toBe(1)
    expect(result.history[0]).toEqual(anns)
  })
})
