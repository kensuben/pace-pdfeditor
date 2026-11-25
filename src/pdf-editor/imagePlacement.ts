import type { Annotation } from '../types'
import type { PageView } from './pageGeometry'
import { viewToPdf } from './pageGeometry'
import type { Rect } from './engine/types'
import { multMatrix } from './engine/textGeometry'
import { invertMatrix } from './engine/imageTransform'

export type Matrix = [number, number, number, number, number, number]


/**
 * Computes the target matrix [a, b, c, d, e, f] in PDF user space that maps the
 * unit square [0, 0] to [1, 1] of an image into its final position on the page,
 * taking into account annotation bounding box, horizontal/vertical flip, and 90° rotation increments.
 *
 * Sequence of transforms around box center: flip first, then rotation.
 * 3 key corners of upright image:
 * - P0: bottom-left
 * - P1: bottom-right
 * - P2: top-left
 *
 * Returned matrix: [P1.x - P0.x, P1.y - P0.y, P2.x - P0.x, P2.y - P0.y, P0.x, P0.y].
 */
export function imagePlacementMatrix(
  a: Annotation,
  view: PageView,
): Matrix {
  const rot = (a.imageRotation || 0) as 0 | 90 | 180 | 270
  const flipH = Boolean(a.flipH)
  const flipV = Boolean(a.flipV)

  // In normalized view space:
  // Center of the bounding box on screen:
  const uc = a.x + a.width / 2
  const vc = a.y + a.height / 2

  // Dimensions of the upright image in normalized view space:
  // When rotated 90 or 270, displayed width is upright height and displayed height is upright width.
  const Wimg = rot === 90 || rot === 270 ? a.height : a.width
  const Himg = rot === 90 || rot === 270 ? a.width : a.height

  // 3 key corners of the upright image in local coordinates (origin at image center):
  // Screen coordinate convention: xi right (+), eta down (+)
  // 1. Bottom-left (dưới-trái): xi = -Wimg / 2, eta = +Himg / 2
  // 2. Bottom-right (dưới-phải): xi = +Wimg / 2, eta = +Himg / 2
  // 3. Top-left (trên-trái): xi = -Wimg / 2, eta = -Himg / 2
  const localCorners: Array<{ xi: number; eta: number }> = [
    { xi: -Wimg / 2, eta: Himg / 2 }, // P0: bottom-left
    { xi: Wimg / 2, eta: Himg / 2 },  // P1: bottom-right
    { xi: -Wimg / 2, eta: -Himg / 2 }, // P2: top-left
  ]

  const viewCorners = localCorners.map((c) => {
    // 1. Apply flip in local coordinate frame (flip first)
    const xiFlipped = flipH ? -c.xi : c.xi
    const etaFlipped = flipV ? -c.eta : c.eta

    // 2. Apply rotation clockwise on screen (rotate second)
    // In screen coordinates where y/v points down:
    // deltaU = xi * cos(theta) - eta * sin(theta)
    // deltaV = xi * sin(theta) + eta * cos(theta)
    let du = 0
    let dv = 0
    switch (rot) {
      case 0:
        du = xiFlipped
        dv = etaFlipped
        break
      case 90:
        du = -etaFlipped
        dv = xiFlipped
        break
      case 180:
        du = -xiFlipped
        dv = -etaFlipped
        break
      case 270:
        du = etaFlipped
        dv = -xiFlipped
        break
    }

    return {
      u: uc + du,
      v: vc + dv,
    }
  })

  // Convert the 3 points to PDF user space
  const P0 = viewToPdf(view, viewCorners[0].u, viewCorners[0].v)
  const P1 = viewToPdf(view, viewCorners[1].u, viewCorners[1].v)
  const P2 = viewToPdf(view, viewCorners[2].u, viewCorners[2].v)

  return [
    P1.x - P0.x,
    P1.y - P0.y,
    P2.x - P0.x,
    P2.y - P0.y,
    P0.x,
    P0.y,
  ]
}

/**
 * Pure function computing the full image matrix F and bounding clip rect in PDF user space.
 *
 * P = imagePlacementMatrix(a, view) maps the unit square to the remaining cropped box.
 * S = [sx, 0, 0, sy, l, b] maps the unit square of the full image to the cropped sub-region,
 * where sx = 1 - left - right, sy = 1 - top - bottom, l = left, b = bottom.
 * The full image matrix is F = S⁻¹ × P.
 *
 * clip is the bounding box in PDF user space of the annotation's 4 corners.
 */
export function croppedImageMatrix(
  a: Annotation,
  view: PageView,
): { matrix: Matrix; clip: Rect } {
  const P = imagePlacementMatrix(a, view)

  const c1 = viewToPdf(view, a.x, a.y)
  const c2 = viewToPdf(view, a.x + a.width, a.y)
  const c3 = viewToPdf(view, a.x + a.width, a.y + a.height)
  const c4 = viewToPdf(view, a.x, a.y + a.height)
  const minX = Math.min(c1.x, c2.x, c3.x, c4.x)
  const maxX = Math.max(c1.x, c2.x, c3.x, c4.x)
  const minY = Math.min(c1.y, c2.y, c3.y, c4.y)
  const maxY = Math.max(c1.y, c2.y, c3.y, c4.y)
  const clip: Rect = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }

  const crop = a.imageCrop
  if (!crop || (crop.left === 0 && crop.top === 0 && crop.right === 0 && crop.bottom === 0)) {
    return { matrix: P, clip }
  }

  const sx = 1 - crop.left - crop.right
  const sy = 1 - crop.top - crop.bottom
  const l = crop.left
  const b = crop.bottom

  const S: Matrix = [sx, 0, 0, sy, l, b]
  const S_inv = invertMatrix(S)
  if (!S_inv) {
    return { matrix: P, clip }
  }

  const matrix = multMatrix(S_inv, P)
  return { matrix, clip }
}

/**
 * Calculates new annotation position and size when imageCrop changes,
 * preserving the remaining image's position and appearance on screen.
 */
export function applyImageCrop(
  a: Annotation,
  newCrop: { left: number; top: number; right: number; bottom: number },
): Annotation {
  const rot = (a.imageRotation || 0) as 0 | 90 | 180 | 270
  const flipH = Boolean(a.flipH)
  const flipV = Boolean(a.flipV)

  const oldCrop = a.imageCrop || { left: 0, top: 0, right: 0, bottom: 0 }

  const W_rem_old = rot === 90 || rot === 270 ? a.height : a.width
  const H_rem_old = rot === 90 || rot === 270 ? a.width : a.height

  const sx_old = Math.max(0.01, 1 - oldCrop.left - oldCrop.right)
  const sy_old = Math.max(0.01, 1 - oldCrop.top - oldCrop.bottom)

  const W0 = W_rem_old / sx_old
  const H0 = H_rem_old / sy_old

  const delta_xi_c = (newCrop.left - newCrop.right) * W0 / 2 - (oldCrop.left - oldCrop.right) * W0 / 2
  const delta_eta_c = (newCrop.top - newCrop.bottom) * H0 / 2 - (oldCrop.top - oldCrop.bottom) * H0 / 2

  const delta_xi_flipped = flipH ? -delta_xi_c : delta_xi_c
  const delta_eta_flipped = flipV ? -delta_eta_c : delta_eta_c

  let du = 0
  let dv = 0
  switch (rot) {
    case 0:
      du = delta_xi_flipped
      dv = delta_eta_flipped
      break
    case 90:
      du = -delta_eta_flipped
      dv = delta_xi_flipped
      break
    case 180:
      du = -delta_xi_flipped
      dv = -delta_eta_flipped
      break
    case 270:
      du = delta_eta_flipped
      dv = -delta_xi_flipped
      break
  }

  const uc_old = a.x + a.width / 2
  const vc_old = a.y + a.height / 2
  const uc_new = uc_old + du
  const vc_new = vc_old + dv

  const sx_new = Math.max(0.01, 1 - newCrop.left - newCrop.right)
  const sy_new = Math.max(0.01, 1 - newCrop.top - newCrop.bottom)

  const W_rem_new = W0 * sx_new
  const H_rem_new = H0 * sy_new

  const w_new = rot === 90 || rot === 270 ? H_rem_new : W_rem_new
  const h_new = rot === 90 || rot === 270 ? W_rem_new : H_rem_new

  const x_new = uc_new - w_new / 2
  const y_new = vc_new - h_new / 2

  return {
    ...a,
    x: x_new,
    y: y_new,
    width: w_new,
    height: h_new,
    imageCrop: newCrop,
  }
}

export interface CroppedPreviewLayout {
  width: number
  height: number
  fullWidth: number
  fullHeight: number
  dx: number
  dy: number
  dXi: number
  dEta: number
}

/**
 * Computes the preview layout (dimensions and offset) of the full image in upright coordinates
 * so that the cropped portion aligns exactly with the annotation's displayed bounding box.
 */
export function croppedPreviewLayout(
  a: Pick<Annotation, 'x' | 'y' | 'width' | 'height'> & {
    imageRotation?: number
    imageCrop?: { left: number; top: number; right: number; bottom: number }
  },
  pageSizePx: { width: number; height: number },
): CroppedPreviewLayout {
  const rot = a.imageRotation ?? 0
  const isRotated = rot === 90 || rot === 270

  const crop = a.imageCrop || { left: 0, top: 0, right: 0, bottom: 0 }
  const sx = Math.max(0.01, 1 - crop.left - crop.right)
  const sy = Math.max(0.01, 1 - crop.top - crop.bottom)

  const remW = isRotated ? a.height * pageSizePx.height : a.width * pageSizePx.width
  const remH = isRotated ? a.width * pageSizePx.width : a.height * pageSizePx.height

  const fullW = remW / sx
  const fullH = remH / sy

  const dXi = ((crop.right - crop.left) / (2 * sx)) * remW
  const dEta = ((crop.bottom - crop.top) / (2 * sy)) * remH

  return {
    width: fullW,
    height: fullH,
    fullWidth: fullW,
    fullHeight: fullH,
    dx: dXi,
    dy: dEta,
    dXi,
    dEta,
  }
}

/**
 * Samples background color from a rendered canvas behind a region.
 * When options.outside is true, samples from a 2-4px ring outside the region's 4 edges,
 * skipping points outside the page bounds, and returns the dominant color.
 */
export function sampleBackground(
  region: { x: number; y: number; width: number; height: number },
  canvas: HTMLCanvasElement | null,
  size: { width: number; height: number },
  options?: { outside?: boolean },
): string {
  if (!canvas) return '#ffffff'
  const ratioX = canvas.width / size.width
  const ratioY = canvas.height / size.height
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) return '#ffffff'

  const samples: number[][] = []

  if (options?.outside) {
    const x0 = region.x * size.width * ratioX
    const y0 = region.y * size.height * ratioY
    const w = region.width * size.width * ratioX
    const h = region.height * size.height * ratioY
    const x1 = x0 + w
    const y1 = y0 + h

    // Sample 2–4 px outside 4 edges
    const offsets = [2, 3, 4]
    const stepsX = 13
    const stepsY = 7

    for (const d of offsets) {
      // Top edge: y = y0 - d
      const topY = y0 - d
      if (topY >= 0 && topY < canvas.height) {
        for (let i = 0; i < stepsX; i++) {
          const x = x0 + ((i + 0.5) / stepsX) * w
          if (x >= 0 && x < canvas.width) {
            samples.push(Array.from(ctx.getImageData(Math.round(x), Math.round(topY), 1, 1).data.slice(0, 3)))
          }
        }
      }

      // Bottom edge: y = y1 + d
      const bottomY = y1 + d
      if (bottomY >= 0 && bottomY < canvas.height) {
        for (let i = 0; i < stepsX; i++) {
          const x = x0 + ((i + 0.5) / stepsX) * w
          if (x >= 0 && x < canvas.width) {
            samples.push(Array.from(ctx.getImageData(Math.round(x), Math.round(bottomY), 1, 1).data.slice(0, 3)))
          }
        }
      }

      // Left edge: x = x0 - d
      if (x0 - d >= 0 && x0 - d < canvas.width) {
        const leftX = x0 - d
        for (let j = 0; j < stepsY; j++) {
          const y = y0 + ((j + 0.5) / stepsY) * h
          if (y >= 0 && y < canvas.height) {
            samples.push(Array.from(ctx.getImageData(Math.round(leftX), Math.round(y), 1, 1).data.slice(0, 3)))
          }
        }
      }

      // Right edge: x = x1 + d
      if (x1 + d >= 0 && x1 + d < canvas.width) {
        const rightX = x1 + d
        for (let j = 0; j < stepsY; j++) {
          const y = y0 + ((j + 0.5) / stepsY) * h
          if (y >= 0 && y < canvas.height) {
            samples.push(Array.from(ctx.getImageData(Math.round(rightX), Math.round(y), 1, 1).data.slice(0, 3)))
          }
        }
      }
    }
  } else {
    // Existing inside sampling (W-9)
    for (let row = 0; row < 7; row++) {
      for (let column = 0; column < 13; column++) {
        const px = (column + 0.5) / 13
        const py = (row + 0.5) / 7
        const x = Math.min(Math.max(0, Math.round((region.x + region.width * px) * size.width * ratioX)), canvas.width - 1)
        const y = Math.min(Math.max(0, Math.round((region.y + region.height * py) * size.height * ratioY)), canvas.height - 1)
        samples.push(Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)))
      }
    }
  }

  if (samples.length === 0) return '#ffffff'

  const buckets = new Map<string, number[][]>()
  samples.forEach((pixel) => {
    const key = pixel.map((channel) => Math.round(channel / 12) * 12).join(',')
    buckets.set(key, [...(buckets.get(key) || []), pixel])
  })
  const dominant = [...buckets.values()].sort((a, b) => b.length - a.length)[0] || [[255, 255, 255]]
  const channel = (index: number) =>
    Math.round(dominant.reduce((sum, pixel) => sum + pixel[index], 0) / dominant.length)
  return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

