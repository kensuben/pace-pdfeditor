import type { Annotation, Point } from '../types'
import { clamp } from './geometry'

/**
 * Returns the fill color for an annotation when rendered on screen.
 * Highlights return their color; other annotation types return undefined.
 */
export function annotationFill(a: Annotation): string | undefined {
  if (a.type === 'highlight') {
    return a.color
  }
  return undefined
}

/**
 * Computes a normalized bounding box between start and end drag points.
 * Coordinates (x, y) are the top-left corner, and dimensions (width, height) are non-negative.
 * Clamps coordinates to the [0, 1] page range.
 */
export function draftRect(
  start: Point,
  end: Point,
): { x: number; y: number; width: number; height: number } {
  const x1 = clamp(start.x, 0, 1)
  const y1 = clamp(start.y, 0, 1)
  const x2 = clamp(end.x, 0, 1)
  const y2 = clamp(end.y, 0, 1)

  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const width = Math.max(0, Math.abs(x2 - x1))
  const height = Math.max(0, Math.abs(y2 - y1))

  return { x, y, width, height }
}
