import type { Annotation } from '../types'
import type { PageView } from './pageGeometry'
import { viewToPdf } from './pageGeometry'

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
): [number, number, number, number, number, number] {
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
