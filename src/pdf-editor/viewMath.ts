import type { Annotation } from '../types'
import { clamp } from './geometry'

export const FIT_PADDING = 32

export type FitMode = 'width' | 'page'

/**
 * K1: Picks the current page based on visible area.
 * Returns the page (1-indexed) with the maximum visible area.
 * If all areas are <= 0, returns currentPage.
 */
export function pickCurrentPage(
  pageVisibilities: number[] | { page: number; area: number }[],
  currentPage: number,
): number {
  if (pageVisibilities.length === 0) return currentPage

  if (typeof pageVisibilities[0] === 'number') {
    const areas = pageVisibilities as number[]
    let maxArea = 0
    let bestPage = currentPage
    for (let i = 0; i < areas.length; i++) {
      if (areas[i] > maxArea) {
        maxArea = areas[i]
        bestPage = i + 1
      }
    }
    return maxArea > 0 ? bestPage : currentPage
  }

  const items = pageVisibilities as { page: number; area: number }[]
  let maxArea = 0
  let bestPage = currentPage
  for (const item of items) {
    if (item.area > maxArea) {
      maxArea = item.area
      bestPage = item.page
    }
  }
  return maxArea > 0 ? bestPage : currentPage
}

/**
 * K2: Computes fit zoom clamped in [0.25, 4].
 * "Vừa chiều rộng": (container.width - padding) / pageSize.width
 * "Vừa trang": min((container.width - padding) / pageSize.width, (container.height - padding) / pageSize.height)
 */
export function fitZoom(
  container: { width: number; height: number },
  pageSize: { width: number; height: number },
  mode: FitMode,
  padding: number = FIT_PADDING,
): number {
  const availableW = Math.max(0, container.width - padding)
  const availableH = Math.max(0, container.height - padding)
  let scale: number
  if (mode === 'width') {
    scale = availableW / pageSize.width
  } else {
    scale = Math.min(availableW / pageSize.width, availableH / pageSize.height)
  }
  return clamp(scale, 0.25, 4)
}

/**
 * K3: Zoom around pointer keeping the content point under the pointer stationary.
 */
export interface ZoomAroundParams {
  currentZoom: number
  nextZoom: number
  pointer: { x: number; y: number }
  scroll: { left: number; top: number }
}

export function zoomAroundPoint(
  arg1: number | ZoomAroundParams,
  arg2?: number,
  arg3?: { x: number; y: number },
  arg4?: { left: number; top: number },
): { scrollLeft: number; scrollTop: number; nextScrollLeft: number; nextScrollTop: number } {
  let currentZoom: number
  let nextZoom: number
  let pointer: { x: number; y: number }
  let scroll: { left: number; top: number }

  if (typeof arg1 === 'object') {
    currentZoom = arg1.currentZoom
    nextZoom = arg1.nextZoom
    pointer = arg1.pointer
    scroll = arg1.scroll
  } else {
    currentZoom = arg1
    nextZoom = arg2!
    pointer = arg3!
    scroll = arg4!
  }

  const ratio = nextZoom / currentZoom
  const nextScrollLeft = (scroll.left + pointer.x) * ratio - pointer.x
  const nextScrollTop = (scroll.top + pointer.y) * ratio - pointer.y

  return {
    scrollLeft: nextScrollLeft,
    scrollTop: nextScrollTop,
    nextScrollLeft,
    nextScrollTop,
  }
}

/**
 * Check if the page can be rotated.
 * If any annotation on this page has replaceOriginal === true, rotation is blocked.
 */
export function canRotatePage(annotations: Annotation[], page: number): boolean {
  return !annotations.some((a) => a.page === page && a.replaceOriginal)
}

/**
 * K4: Rotates annotations 90 degrees clockwise for the given page.
 * Formula for points: (x, y) -> (1 - y, x)
 * Formula for highlight: (x, y, w, h) -> (1 - y - h, x, h, w)
 * Text and image: maintain real pt dimensions on new page, rotate center by (1 - cy, cx).
 */
export function rotateAnnotationsCw(
  annotations: Annotation[],
  page: number,
  oldViewPt: { width: number; height: number },
  newViewPt?: { width: number; height: number },
): Annotation[] {
  const targetView = newViewPt ?? { width: oldViewPt.height, height: oldViewPt.width }

  return annotations.map((a) => {
    if (a.page !== page) return a

    if (a.type === 'highlight') {
      return {
        ...a,
        x: 1 - a.y - a.height,
        y: a.x,
        width: a.height,
        height: a.width,
      }
    }

    if (a.type === 'draw' || a.points) {
      const nextPoints = a.points?.map((p) => ({
        x: 1 - p.y,
        y: p.x,
      }))
      return {
        ...a,
        x: 1 - a.y - a.height,
        y: a.x,
        width: a.height,
        height: a.width,
        points: nextPoints,
      }
    }

    if (a.type === 'text' || a.type === 'image') {
      const ptW = a.width * oldViewPt.width
      const ptH = a.height * oldViewPt.height

      const newW = ptW / targetView.width
      const newH = ptH / targetView.height

      const cx = a.x + a.width / 2
      const cy = a.y + a.height / 2

      const newCx = 1 - cy
      const newCy = cx

      const newX = newCx - newW / 2
      const newY = newCy - newH / 2

      return {
        ...a,
        x: newX,
        y: newY,
        width: newW,
        height: newH,
      }
    }

    return {
      ...a,
      x: 1 - a.y - a.height,
      y: a.x,
      width: a.height,
      height: a.width,
    }
  })
}

/**
 * K6 helper: reset history after a page operation.
 */
export function resetHistoryOnPageOp(annotations: Annotation[]): {
  history: Annotation[][]
  historyIndex: number
} {
  return {
    history: [annotations],
    historyIndex: 0,
  }
}

/**
 * Global semaphore to limit concurrent pdf.js page renders (max 2).
 */
class RenderQueue {
  private active = 0
  private readonly max = 2
  private waiting: (() => void)[] = []

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++
      return () => this.release()
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active++
        resolve(() => this.release())
      })
    })
  }

  private release() {
    this.active--
    const next = this.waiting.shift()
    if (next) {
      next()
    }
  }
}

export const globalRenderQueue = new RenderQueue()

