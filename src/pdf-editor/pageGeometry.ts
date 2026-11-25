import type { PDFPage } from 'pdf-lib'

export interface PageView {
  box: [number, number, number, number] // [x0, y0, x1, y1]
  rotation: 0 | 90 | 180 | 270
}

/**
 * Computes the effective view bounds and normalized rotation of a PDF page.
 * View box is CropBox ∩ MediaBox (matching pdf.js behavior; falls back to MediaBox if empty).
 * Throws UNSUPPORTED_ROTATION if rotation angle is not a multiple of 90 degrees.
 */
export function getPageView(page: PDFPage): PageView {
  const rotAngle = ((page.getRotation().angle % 360) + 360) % 360
  if (rotAngle !== 0 && rotAngle !== 90 && rotAngle !== 180 && rotAngle !== 270) {
    throw new Error(`UNSUPPORTED_ROTATION: Page rotation ${rotAngle} is not a multiple of 90 degrees`)
  }
  const rotation = rotAngle as 0 | 90 | 180 | 270

  const m = page.getMediaBox()
  const mX0 = Math.min(m.x, m.x + m.width)
  const mX1 = Math.max(m.x, m.x + m.width)
  const mY0 = Math.min(m.y, m.y + m.height)
  const mY1 = Math.max(m.y, m.y + m.height)

  const c = page.getCropBox()
  const cX0 = Math.min(c.x, c.x + c.width)
  const cX1 = Math.max(c.x, c.x + c.width)
  const cY0 = Math.min(c.y, c.y + c.height)
  const cY1 = Math.max(c.y, c.y + c.height)

  const minX = Math.max(mX0, cX0)
  const maxX = Math.min(mX1, cX1)
  const minY = Math.max(mY0, cY0)
  const maxY = Math.min(mY1, cY1)

  let box: [number, number, number, number]
  if (minX < maxX && minY < maxY) {
    box = [minX, minY, maxX, maxY]
  } else {
    box = [mX0, mY0, mX1, mY1]
  }

  return { box, rotation }
}

/**
 * Returns the width and height of the visible page frame in PDF points (view space).
 * Swaps dimensions when rotation is 90 or 270 degrees.
 */
export function viewSizePt(view: PageView): { width: number; height: number } {
  const [x0, y0, x1, y1] = view.box
  const boxW = x1 - x0
  const boxH = y1 - y0

  if (view.rotation === 90 || view.rotation === 270) {
    return { width: boxH, height: boxW }
  }
  return { width: boxW, height: boxH }
}

/**
 * Maps normalized coordinates (u, v) in [0, 1] relative to the visible page frame (top-left is (0, 0))
 * into PDF user space coordinates (x, y). Matches pdf.js viewport.convertToPdfPoint at scale: 1.
 */
export function viewToPdf(
  view: PageView,
  u: number,
  v: number,
): { x: number; y: number } {
  const [x0, y0, x1, y1] = view.box
  const boxW = x1 - x0
  const boxH = y1 - y0

  switch (view.rotation) {
    case 0:
      return {
        x: x0 + u * boxW,
        y: y1 - v * boxH,
      }
    case 90:
      return {
        x: x0 + v * boxW,
        y: y0 + u * boxH,
      }
    case 180:
      return {
        x: x1 - u * boxW,
        y: y0 + v * boxH,
      }
    case 270:
      return {
        x: x1 - v * boxW,
        y: y1 - u * boxH,
      }
  }
}

/**
 * Maps PDF user space coordinates (x, y) into normalized coordinates (u, v) in [0, 1]
 * relative to the visible page frame (top-left is (0, 0)). Exact inverse of viewToPdf.
 */
export function pdfToView(
  view: PageView,
  x: number,
  y: number,
): { u: number; v: number } {
  const [x0, y0, x1, y1] = view.box
  const boxW = x1 - x0
  const boxH = y1 - y0

  switch (view.rotation) {
    case 0:
      return {
        u: (x - x0) / boxW,
        v: (y1 - y) / boxH,
      }
    case 90:
      return {
        u: (y - y0) / boxH,
        v: (x - x0) / boxW,
      }
    case 180:
      return {
        u: (x1 - x) / boxW,
        v: (y - y0) / boxH,
      }
    case 270:
      return {
        u: (y1 - y) / boxH,
        v: (x1 - x) / boxW,
      }
  }
}

