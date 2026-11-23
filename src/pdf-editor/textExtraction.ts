import * as pdfjs from 'pdfjs-dist'
import type { TextRegion } from '../types'
import { clamp, uid } from './geometry'
import { viewToPdf, type PageView } from './pageGeometry'
import { styleFromBaseFont } from './fonts'
import type { TextStyleProbe } from './engine/textStyleProbe'

export function familyFromFontLabel(label: string): 'Helvetica' | 'Times Roman' | 'Courier' {
  const l = (label || '').toLowerCase()
  if (/courier|mono|consolas/.test(l)) return 'Courier'
  if (/times|georgia|garamond|cambria/.test(l)) return 'Times Roman'
  if (/serif/.test(l) && !/sans/.test(l)) return 'Times Roman'
  return 'Helvetica'
}

export function groupTextItemsIntoLines(
  items: unknown[],
  styles: Record<string, { fontFamily?: string } | undefined>,
  viewport: { transform: number[]; width: number; height: number },
  pageNumber: number,
): TextRegion[] {
  const fragments = items.flatMap((raw, index): TextRegion[] => {
    if (!raw || typeof raw !== 'object' || !('str' in raw)) return []
    const rawItem = raw as { str: string; transform?: number[]; width?: number; height?: number; fontName?: string }
    if (!rawItem.str.trim() || !rawItem.transform) return []
    const item = {
      str: rawItem.str,
      transform: rawItem.transform,
      width: rawItem.width ?? 0,
      height: rawItem.height ?? 0,
      fontName: rawItem.fontName,
    }
    const tx = pdfjs.Util.transform(viewport.transform, item.transform)
    const fontHeight = Math.max(Math.hypot(tx[2], tx[3]), item.height || 8)
    const fontInfo = item.fontName ? styles[item.fontName] : undefined
    const fontLabel = `${item.fontName || ''} ${fontInfo?.fontFamily || ''}`.toLowerCase()
    const fontFamily = familyFromFontLabel(fontLabel)

    const angle = Math.atan2(tx[1], tx[0]) * (180 / Math.PI)
    if (Math.abs(angle) <= 2) {
      return [{
        id: `native-${pageNumber}-${index}`,
        page: pageNumber,
        text: item.str,
        x: clamp(tx[4] / viewport.width, 0, 1),
        y: clamp((tx[5] - fontHeight) / viewport.height, 0, 1),
        width: clamp((item.width || fontHeight) / viewport.width, 0.002, 1),
        height: clamp(fontHeight / viewport.height, 0.005, 1),
        fontSize: fontHeight,
        fontFamily,
        bold: /bold|black|heavy/.test(fontLabel),
        italic: /italic|oblique/.test(fontLabel),
        color: '#000000',
        align: 'left',
        source: 'native',
      }]
    }

    // Rotated text |angle| > 2°
    // TODO(verify): vector signs for rotated text bounding box in viewport coordinates (P0, P0+v_text, P0+v_height, P0+v_text+v_height)
    const tLen = Math.hypot(tx[0], tx[1])
    const ux = tLen > 0 ? tx[0] / tLen : 1
    const uy = tLen > 0 ? tx[1] / tLen : 0
    const textLen = item.width || fontHeight
    const vx = ux * textLen
    const vy = uy * textLen

    const hLen = Math.hypot(tx[2], tx[3])
    const hx = hLen > 0 ? tx[2] / hLen : 0
    const hy = hLen > 0 ? tx[3] / hLen : -1
    const wx = hx * fontHeight
    const wy = hy * fontHeight

    const p0x = tx[4]
    const p0y = tx[5]
    const p1x = p0x + vx
    const p1y = p0y + vy
    const p2x = p0x + vx + wx
    const p2y = p0y + vy + wy
    const p3x = p0x + wx
    const p3y = p0y + wy

    const minX = Math.min(p0x, p1x, p2x, p3x)
    const maxX = Math.max(p0x, p1x, p2x, p3x)
    const minY = Math.min(p0y, p1y, p2y, p3y)
    const maxY = Math.max(p0y, p1y, p2y, p3y)

    const normX = clamp(minX / viewport.width, 0, 1)
    const normY = clamp(minY / viewport.height, 0, 1)
    const normW = clamp((maxX - minX) / viewport.width, 0.002, 1)
    const normH = clamp((maxY - minY) / viewport.height, 0.005, 1)
    const rotation = Math.round(angle)

    return [{
      id: `native-${pageNumber}-${index}`,
      page: pageNumber,
      text: item.str,
      x: normX,
      y: normY,
      width: normW,
      height: normH,
      fontSize: fontHeight,
      fontFamily,
      bold: /bold|black|heavy/.test(fontLabel),
      italic: /italic|oblique/.test(fontLabel),
      color: '#000000',
      align: 'left',
      source: 'native',
      rotation,
    }]
  })

  const uniqueFragments = fragments.filter((fragment, index, list) =>
    !list.slice(0, index).some((previous) =>
      previous.text === fragment.text &&
      Math.abs(previous.x - fragment.x) < 0.002 &&
      Math.abs(previous.y - fragment.y) < 0.002 &&
      Math.abs(previous.width - fragment.width) < 0.003,
    ),
  )

  const regions = uniqueFragments.sort((a, b) => a.y - b.y || a.x - b.x).reduce<TextRegion[]>((lines, fragment) => {
    if (fragment.rotation !== undefined) {
      lines.push({ ...fragment, id: `native-line-${pageNumber}-${lines.length}` })
      return lines
    }

    const centerY = fragment.y + fragment.height / 2
    const line = lines.find((candidate) =>
      candidate.rotation === undefined &&
      Math.abs((candidate.y + candidate.height / 2) - centerY) <= Math.max(candidate.height, fragment.height) * 0.42 &&
      fragment.x - (candidate.x + candidate.width) <= Math.max(0.025, fragment.fontSize * 3 / viewport.width) &&
      Math.abs(candidate.fontSize - fragment.fontSize) <= Math.max(1, fragment.fontSize * 0.25) &&
      candidate.fontFamily === fragment.fontFamily &&
      candidate.bold === fragment.bold &&
      candidate.italic === fragment.italic,
    )
    if (!line) {
      lines.push({ ...fragment, id: `native-line-${pageNumber}-${lines.length}` })
      return lines
    }
    const lineRight = line.x + line.width
    const fragmentRight = fragment.x + fragment.width
    const gap = (fragment.x - lineRight) * viewport.width
    const separator = gap > Math.max(1, fragment.fontSize * 0.12) && !line.text.endsWith(' ') ? ' ' : ''
    line.text = `${line.text}${separator}${fragment.text}`
    const left = Math.min(line.x, fragment.x)
    const top = Math.min(line.y, fragment.y)
    line.width = Math.max(lineRight, fragmentRight) - left
    line.height = Math.max(line.y + line.height, fragment.y + fragment.height) - top
    line.x = left
    line.y = top
    line.fontSize = Math.max(line.fontSize, fragment.fontSize)
    return lines
  }, [])

  return regions
}

export function enrichRegionsWithStyles(
  regions: TextRegion[],
  probes: TextStyleProbe[],
  view: PageView,
): TextRegion[] {
  return regions.map((region) => {
    if (region.source === 'ocr') {
      return { ...region }
    }

    const c1 = viewToPdf(view, region.x, region.y)
    const c2 = viewToPdf(view, region.x + region.width, region.y)
    const c3 = viewToPdf(view, region.x + region.width, region.y + region.height)
    const c4 = viewToPdf(view, region.x, region.y + region.height)

    const minPdfX = Math.min(c1.x, c2.x, c3.x, c4.x) - 1
    const minPdfY = Math.min(c1.y, c2.y, c3.y, c4.y) - 1
    const maxPdfX = Math.max(c1.x, c2.x, c3.x, c4.x) + 1
    const maxPdfY = Math.max(c1.y, c2.y, c3.y, c4.y) + 1

    const matchingProbes = probes.filter((p) => {
      const cx = p.bbox.x + p.bbox.width / 2
      const cy = p.bbox.y + p.bbox.height / 2
      return cx >= minPdfX && cx <= maxPdfX && cy >= minPdfY && cy <= maxPdfY
    })

    if (matchingProbes.length === 0) {
      return { ...region }
    }

    let bestColor = region.color
    const colorWidths = new Map<string, number>()
    for (const p of matchingProbes) {
      if (p.color !== undefined) {
        colorWidths.set(p.color, (colorWidths.get(p.color) || 0) + p.bbox.width)
      }
    }
    if (colorWidths.size > 0) {
      let maxW = -1
      for (const [col, totalW] of colorWidths.entries()) {
        if (totalW > maxW) {
          maxW = totalW
          bestColor = col
        }
      }
    }

    let bestFamily = region.fontFamily
    let bestBold = region.bold
    let bestItalic = region.italic

    const probesWithFont = matchingProbes.filter((p) => p.baseFont !== undefined)
    if (probesWithFont.length > 0) {
      probesWithFont.sort((a, b) => b.bbox.width - a.bbox.width)
      const chosen = probesWithFont[0]
      const style = styleFromBaseFont(chosen.baseFont)
      bestFamily = style.family
      bestBold = style.bold
      bestItalic = style.italic
    }

    return {
      ...region,
      color: bestColor,
      fontFamily: bestFamily,
      bold: bestBold,
      italic: bestItalic,
    }
  })
}

export function parseOcrTsv(
  tsv: string,
  page: number,
  canvasWidth: number,
  canvasHeight: number,
  makeId: () => string = uid,
): TextRegion[] {
  return tsv.split(/\r?\n/).slice(1).flatMap((line, index): TextRegion[] => {
    const cols = line.split('\t')
    if (cols.length < 12 || cols[0] !== '5') return []
    const left = Number(cols[6])
    const top = Number(cols[7])
    const w = Number(cols[8])
    const h = Number(cols[9])
    const confidence = Number(cols[10])
    const text = cols.slice(11).join('\t').trim()
    if (!text || confidence < 35 || w <= 0 || h <= 0) return []
    return [{
      id: `ocr-${page}-${index}-${makeId()}`,
      page,
      text,
      x: left / canvasWidth,
      y: top / canvasHeight,
      width: w / canvasWidth,
      height: h / canvasHeight,
      fontSize: Math.max(7, h / 2),
      confidence,
      source: 'ocr',
    }]
  })
}

export function groupOcrWordsIntoLines(
  words: TextRegion[],
  page: number,
  makeId: () => string = uid,
): TextRegion[] {
  return words.sort((a, b) => a.y - b.y || a.x - b.x).reduce<TextRegion[]>((lines, word) => {
    const centerY = word.y + word.height / 2
    const current = lines.find((candidate) =>
      Math.abs((candidate.y + candidate.height / 2) - centerY) <= Math.max(candidate.height, word.height) * 0.45 &&
      word.x - (candidate.x + candidate.width) <= Math.max(0.025, word.height * 2.5),
    )
    if (!current) {
      lines.push({
        ...word,
        id: `ocr-line-${page}-${lines.length}-${makeId()}`,
        fontFamily: 'Helvetica',
        color: '#000000',
        align: 'left',
      })
      return lines
    }
    const right = Math.max(current.x + current.width, word.x + word.width)
    const top = Math.min(current.y, word.y)
    current.text = `${current.text} ${word.text}`
    current.width = right - Math.min(current.x, word.x)
    current.x = Math.min(current.x, word.x)
    current.height = Math.max(current.y + current.height, word.y + word.height) - top
    current.y = top
    current.confidence = Math.min(current.confidence ?? 100, word.confidence ?? 100)
    return lines
  }, [])
}
