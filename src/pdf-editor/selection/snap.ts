export interface SnapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal'
  position: number // normalized coordinate in [0, 1]
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

/**
 * Pure function to compute snapping against other candidate rectangles on the same page
 * and page center lines (0.5 for horizontal and vertical).
 *
 * @param rect Target rectangle in normalized coordinates [0, 1]
 * @param candidates Other annotations' bounding boxes on the same page in [0, 1]
 * @param thresholdNorm Snapping threshold in normalized coordinates
 */
export function computeSnap(
  rect: SnapRect,
  candidates: SnapRect[],
  thresholdNorm: number | { x: number; y: number },
): SnapResult {
  const threshX = typeof thresholdNorm === 'number' ? thresholdNorm : thresholdNorm.x
  const threshY = typeof thresholdNorm === 'number' ? thresholdNorm : thresholdNorm.y

  let bestDx = 0
  let minDiffX = threshX + 1e-9
  let guideX: SnapGuide | null = null

  // Check candidate edges first (left, right), then center, then page center
  const targetXs: number[] = []
  for (const c of candidates) {
    targetXs.push(c.x, c.x + c.width)
  }
  for (const c of candidates) {
    targetXs.push(c.x + c.width / 2)
  }
  targetXs.push(0.5)

  // Sources for X: left edge, right edge, horizontal center
  const srcXs = [
    rect.x,
    rect.x + rect.width,
    rect.x + rect.width / 2,
  ]

  for (const target of targetXs) {
    for (const src of srcXs) {
      const diff = target - src
      const absDiff = Math.abs(diff)
      // Use small epsilon so exact edge ties are not overwritten by centers
      if (absDiff <= threshX && absDiff < minDiffX - 1e-6) {
        minDiffX = absDiff
        bestDx = diff
        guideX = { orientation: 'vertical', position: target }
      }
    }
  }

  let bestDy = 0
  let minDiffY = threshY + 1e-9
  let guideY: SnapGuide | null = null

  // Check candidate edges first (top, bottom), then center, then page center
  const targetYs: number[] = []
  for (const c of candidates) {
    targetYs.push(c.y, c.y + c.height)
  }
  for (const c of candidates) {
    targetYs.push(c.y + c.height / 2)
  }
  targetYs.push(0.5)

  // Sources for Y: top edge, bottom edge, vertical center
  const srcYs = [
    rect.y,
    rect.y + rect.height,
    rect.y + rect.height / 2,
  ]

  for (const target of targetYs) {
    for (const src of srcYs) {
      const diff = target - src
      const absDiff = Math.abs(diff)
      if (absDiff <= threshY && absDiff < minDiffY - 1e-6) {
        minDiffY = absDiff
        bestDy = diff
        guideY = { orientation: 'horizontal', position: target }
      }
    }
  }

  const guides: SnapGuide[] = []
  if (guideX) guides.push(guideX)
  if (guideY) guides.push(guideY)

  return {
    dx: bestDx,
    dy: bestDy,
    guides,
  }
}
