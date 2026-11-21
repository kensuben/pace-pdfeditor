import type { Annotation } from '../../types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface ResizeOptions {
  keepAspect?: boolean
  minSize?: { w: number; h: number }
}

/**
 * Get normalized [0, 1] bounding box of an annotation.
 * For drawing/signature, calculates AABB enclosing all points.
 */
export function getBounds(a: Annotation): Rect {
  if (a.points && a.points.length > 0) {
    let minX = a.points[0].x
    let maxX = a.points[0].x
    let minY = a.points[0].y
    let maxY = a.points[0].y
    for (let i = 1; i < a.points.length; i++) {
      const p = a.points[i]
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    }
  }
  return {
    x: a.x,
    y: a.y,
    width: a.width,
    height: a.height,
  }
}

/**
 * Move annotation by normalized dx, dy, clamping entire bounding box inside [0, 1].
 */
export function moveBy(a: Annotation, dx: number, dy: number): Annotation {
  const b = getBounds(a)
  const targetX = Math.max(0, Math.min(1 - b.width, b.x + dx))
  const targetY = Math.max(0, Math.min(1 - b.height, b.y + dy))
  const actualDx = targetX - b.x
  const actualDy = targetY - b.y

  if (a.points && a.points.length > 0) {
    const nextPoints = a.points.map((p) => ({
      x: p.x + actualDx,
      y: p.y + actualDy,
    }))
    return {
      ...a,
      x: targetX,
      y: targetY,
      points: nextPoints,
    }
  }

  return {
    ...a,
    x: targetX,
    y: targetY,
  }
}

/**
 * Resize annotation from a given handle. Opposite edge/corner remains anchored.
 * Clamps within [0, 1] page bounds and enforces minSize.
 */
export function resizeFromHandle(
  a: Annotation,
  handle: Handle,
  dx: number,
  dy: number,
  opts?: ResizeOptions,
): Annotation {
  const b = getBounds(a)
  const minW = opts?.minSize?.w ?? 0.01
  const minH = opts?.minSize?.h ?? 0.01
  const isCorner = ['ne', 'nw', 'se', 'sw'].includes(handle)
  const keepAspect = Boolean(opts?.keepAspect && isCorner)

  const left = b.x
  const top = b.y
  const right = b.x + b.width
  const bottom = b.y + b.height

  let fixedX = left
  let fixedY = top
  let signX = 0
  let signY = 0

  switch (handle) {
    case 'se':
      fixedX = left; fixedY = top; signX = 1; signY = 1; break
    case 'nw':
      fixedX = right; fixedY = bottom; signX = -1; signY = -1; break
    case 'ne':
      fixedX = left; fixedY = bottom; signX = 1; signY = -1; break
    case 'sw':
      fixedX = right; fixedY = top; signX = -1; signY = 1; break
    case 'e':
      fixedX = left; fixedY = top; signX = 1; signY = 0; break
    case 'w':
      fixedX = right; fixedY = top; signX = -1; signY = 0; break
    case 's':
      fixedX = left; fixedY = top; signX = 0; signY = 1; break
    case 'n':
      fixedX = left; fixedY = bottom; signX = 0; signY = -1; break
  }

  let newW = signX !== 0 ? b.width + signX * dx : b.width
  let newH = signY !== 0 ? b.height + signY * dy : b.height

  if (keepAspect && b.height > 0 && b.width > 0) {
    const ratio = b.width / b.height
    const scaleX = (b.width + signX * dx) / b.width
    const scaleY = (b.height + signY * dy) / b.height

    if (Math.abs(scaleX - 1) >= Math.abs(scaleY - 1)) {
      newW = b.width * scaleX
      newH = newW / ratio
    } else {
      newH = b.height * scaleY
      newW = newH * ratio
    }
  }

  // Min size constraint
  if (keepAspect && b.height > 0 && b.width > 0) {
    const ratio = b.width / b.height
    if (newW < minW) {
      newW = minW
      newH = newW / ratio
    }
    if (newH < minH) {
      newH = minH
      newW = newH * ratio
    }
  } else {
    newW = Math.max(minW, newW)
    newH = Math.max(minH, newH)
  }

  // Page boundary [0, 1] constraint based on fixed anchor
  if (signX === 1) {
    newW = Math.min(newW, 1 - fixedX)
  } else if (signX === -1) {
    newW = Math.min(newW, fixedX)
  }

  if (signY === 1) {
    newH = Math.min(newH, 1 - fixedY)
  } else if (signY === -1) {
    newH = Math.min(newH, fixedY)
  }

  if (keepAspect && b.height > 0 && b.width > 0) {
    const ratio = b.width / b.height
    if (newW / newH > ratio) {
      newW = newH * ratio
    } else if (newW / newH < ratio) {
      newH = newW / ratio
    }
  }

  const newX = signX === -1 ? fixedX - newW : fixedX
  const newY = signY === -1 ? fixedY - newH : fixedY

  if (a.points && a.points.length > 0 && b.width > 0 && b.height > 0) {
    const scaleX = newW / b.width
    const scaleY = newH / b.height
    const nextPoints = a.points.map((p) => ({
      x: newX + (p.x - b.x) * scaleX,
      y: newY + (p.y - b.y) * scaleY,
    }))
    return {
      ...a,
      x: newX,
      y: newY,
      width: newW,
      height: newH,
      points: nextPoints,
    }
  }

  return {
    ...a,
    x: newX,
    y: newY,
    width: newW,
    height: newH,
  }
}

/**
 * Convert point step to normalized delta based on page size.
 */
export function nudgeDelta(
  pagePt: { width: number; height: number },
  stepPt: number,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
): { dx: number; dy: number } {
  const w = pagePt.width || 1
  const h = pagePt.height || 1
  switch (key) {
    case 'ArrowRight':
      return { dx: stepPt / w, dy: 0 }
    case 'ArrowLeft':
      return { dx: -stepPt / w, dy: 0 }
    case 'ArrowDown':
      return { dx: 0, dy: stepPt / h }
    case 'ArrowUp':
      return { dx: 0, dy: -stepPt / h }
  }
}

/**
 * Calculate image insertion dimensions keeping true physical aspect ratio.
 * Default width: 0.28 of page width. If height > 0.35 of page height, scale down both.
 */
export function imageInsertSize(
  imgPx: { w: number; h: number },
  pagePt: { width: number; height: number },
): { width: number; height: number } {
  const defaultWidth = 0.28
  const pageW = pagePt.width || 1
  const pageH = pagePt.height || 1
  const imgW = imgPx.w || 1
  const imgH = imgPx.h || 1

  let width = defaultWidth
  let height = defaultWidth * (pageW / pageH) * (imgH / imgW)

  if (height > 0.35) {
    const scale = 0.35 / height
    height = 0.35
    width = defaultWidth * scale
  }

  return { width, height }
}

export interface PanelDimensionsPatch {
  xPt?: number
  yPt?: number
  widthPt?: number
  heightPt?: number
  keepAspect?: boolean
  opacity?: number
}

/**
 * Pure function to apply properties panel changes (pt units, aspect lock, opacity)
 * to an annotation in normalized coordinates.
 */
export function applyPanelDimensions(
  annotation: Annotation,
  patch: PanelDimensionsPatch,
  pageSizePt: { width: number; height: number },
): Annotation {
  const b = getBounds(annotation)
  const pageW = pageSizePt.width || 1
  const pageH = pageSizePt.height || 1

  const currentW_pt = b.width * pageW
  const currentH_pt = b.height * pageH
  const currentX_pt = b.x * pageW
  const currentY_pt = b.y * pageH

  const newX_pt = patch.xPt !== undefined ? patch.xPt : currentX_pt
  const newY_pt = patch.yPt !== undefined ? patch.yPt : currentY_pt
  let newW_pt = patch.widthPt !== undefined ? patch.widthPt : currentW_pt
  let newH_pt = patch.heightPt !== undefined ? patch.heightPt : currentH_pt

  // Aspect ratio locking:
  // K3: chỉnh W ở panel cho ảnh 2:1 khi khoá tỉ lệ → H = W/2. Bỏ khoá → H giữ nguyên.
  if (patch.keepAspect && currentH_pt > 0 && currentW_pt > 0) {
    const ratio = currentW_pt / currentH_pt
    if (patch.widthPt !== undefined && patch.heightPt === undefined) {
      newH_pt = newW_pt / ratio
    } else if (patch.heightPt !== undefined && patch.widthPt === undefined) {
      newW_pt = newH_pt * ratio
    }
  }

  const newNormW = newW_pt / pageW
  const newNormH = newH_pt / pageH
  const newNormX = newX_pt / pageW
  const newNormY = newY_pt / pageH

  const clampedX = Math.max(0, Math.min(1 - newNormW, newNormX))
  const clampedY = Math.max(0, Math.min(1 - newNormH, newNormY))

  const updated: Annotation = {
    ...annotation,
    x: clampedX,
    y: clampedY,
    width: newNormW,
    height: newNormH,
  }

  if (patch.opacity !== undefined) {
    updated.opacity = Math.max(0.1, Math.min(1, patch.opacity))
  }

  // Scale drawing/signature points
  if (annotation.points && annotation.points.length > 0 && b.width > 0 && b.height > 0) {
    const scaleX = newNormW / b.width
    const scaleY = newNormH / b.height
    updated.points = annotation.points.map((p) => ({
      x: clampedX + (p.x - b.x) * scaleX,
      y: clampedY + (p.y - b.y) * scaleY,
    }))
  }

  return updated
}

