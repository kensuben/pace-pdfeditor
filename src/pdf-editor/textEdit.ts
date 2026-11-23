import type { Annotation, TextRegion } from '../types'
import { uid } from './geometry'

export function buildReplacementAnnotation(
  region: TextRegion,
  nextText: string,
  neighbors: TextRegion[],
  id: string = uid(),
  pageWidthPt?: number,
): Annotation {
  const overlapsX = (candidate: TextRegion) => candidate.x < region.x + region.width && candidate.x + candidate.width > region.x
  const gapAbove = Math.min(...neighbors.filter((candidate) => candidate.id !== region.id && overlapsX(candidate) && candidate.y + candidate.height <= region.y).map((candidate) => region.y - (candidate.y + candidate.height)), Infinity)
  const gapBelow = Math.min(...neighbors.filter((candidate) => candidate.id !== region.id && overlapsX(candidate) && candidate.y >= region.y + region.height).map((candidate) => candidate.y - (region.y + region.height)), Infinity)
  const desiredTop = region.height * 0.08
  const desiredBottom = region.height * 0.12

  let maxWidth: number | undefined
  if (!region.lineRects || region.lineRects.length === 0) {
    let maxContentRight = region.x + region.width
    for (const nb of neighbors) {
      if (nb.source === 'native' && (nb.rotation === undefined || nb.rotation === 0)) {
        maxContentRight = Math.max(maxContentRight, nb.x + nb.width)
      }
    }

    const centerYRegion = region.y + region.height / 2
    let nearestRightX: number | undefined

    for (const nb of neighbors) {
      if (nb.id === region.id) continue
      const centerYCand = nb.y + nb.height / 2
      const maxH = Math.max(region.height, nb.height)
      const isSameRow = Math.abs(centerYRegion - centerYCand) <= 0.42 * maxH
      const isRight = nb.x >= region.x + region.width - 0.001
      if (isSameRow && isRight) {
        if (nearestRightX === undefined || nb.x < nearestRightX) {
          nearestRightX = nb.x
        }
      }
    }

    const gap = pageWidthPt && pageWidthPt > 0 ? (0.5 * region.fontSize) / pageWidthPt : 0
    let limit = maxContentRight
    if (nearestRightX !== undefined) {
      limit = Math.min(nearestRightX - gap, limit)
    }

    maxWidth = Math.max(region.width, limit - region.x)
  }

  return {
    id,
    page: region.page,
    type: 'text',
    x: region.x,
    y: region.y,
    width: Math.max(region.width, 0.04),
    height: Math.max(region.height, 0.015),
    opacity: 1,
    text: nextText,
    replaceOriginal: true,
    fontFamily: region.fontFamily || 'Helvetica',
    fontSize: Math.max(7, region.fontSize),
    bold: region.bold || false,
    italic: region.italic || false,
    underline: false,
    align: region.align || 'left',
    color: region.color || '#000000',
    backgroundColor: region.backgroundColor || '#ffffff',
    maskPadX: region.height * 0.08,
    maskPadTop: Number.isFinite(gapAbove) ? Math.min(desiredTop, gapAbove * 0.25) : desiredTop,
    maskPadBottom: Number.isFinite(gapBelow) ? Math.min(desiredBottom, gapBelow * 0.25) : desiredBottom,
    originalText: region.text,
    originalSource: region.source,
    originalRect: { x: region.x, y: region.y, width: region.width, height: region.height },
    lineHeight: region.lineHeight,
    originalLineRects: region.lineRects,
    maxWidth,
  }
}
