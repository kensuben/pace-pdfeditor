import type { Annotation, TextRegion } from '../types'
import { uid } from './geometry'

export function buildReplacementAnnotation(
  region: TextRegion,
  nextText: string,
  neighbors: TextRegion[],
  id: string = uid(),
): Annotation {
  const overlapsX = (candidate: TextRegion) => candidate.x < region.x + region.width && candidate.x + candidate.width > region.x
  const gapAbove = Math.min(...neighbors.filter((candidate) => candidate.id !== region.id && overlapsX(candidate) && candidate.y + candidate.height <= region.y).map((candidate) => region.y - (candidate.y + candidate.height)), Infinity)
  const gapBelow = Math.min(...neighbors.filter((candidate) => candidate.id !== region.id && overlapsX(candidate) && candidate.y >= region.y + region.height).map((candidate) => candidate.y - (region.y + region.height)), Infinity)
  const desiredTop = region.height * 0.08
  const desiredBottom = region.height * 0.12

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
  }
}
