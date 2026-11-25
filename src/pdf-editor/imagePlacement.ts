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
