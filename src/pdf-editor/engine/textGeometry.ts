import type { PDFDocument } from 'pdf-lib'
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import type { Rect } from './types'

// TODO(verify): ISO 32000-1 9.6.2.2 Standard 14 Fonts width table.
// pdf-lib bundles StandardFontEmbedder internally to provide glyph widths for Helvetica, Times-Roman, Courier.
interface EmbedderInstance {
  widthOfGlyph: (ch: string) => number
}
interface EmbedderStatic {
  for: (name: string) => EmbedderInstance
}

let standardFontEmbedderMod: EmbedderStatic | null = null
try {
  const mod = await import('pdf-lib/cjs/core/embedders/StandardFontEmbedder.js')
  standardFontEmbedderMod = (mod.default || mod) as unknown as EmbedderStatic
} catch {
  // fallback if dynamic import not available
}

export function multMatrix(
  m1: [number, number, number, number, number, number],
  m2: [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ]
}

export function applyMatrix(
  p: { x: number; y: number },
  m: [number, number, number, number, number, number],
): { x: number; y: number } {
  return {
    x: p.x * m[0] + p.y * m[2] + m[4],
    y: p.x * m[1] + p.y * m[3] + m[5],
  }
}

interface FontMetrics {
  subtype: string
  approximate: boolean
  isType3: boolean
  getGlyphWidth: (byteOrCid: number) => number
  isDoubleByte: boolean
}

export class FontMetricsCache {
  private cache = new Map<string, FontMetrics>()
  private doc: PDFDocument
  private pageIndex: number

  constructor(doc: PDFDocument, pageIndex: number) {
    this.doc = doc
    this.pageIndex = pageIndex
  }

  public getFontMetrics(fontResName: string): FontMetrics {
    const cleanName = fontResName.startsWith('/') ? fontResName.slice(1) : fontResName
    if (this.cache.has(cleanName)) {
      return this.cache.get(cleanName)!
    }

    const page = this.doc.getPage(this.pageIndex)
    const resources = page.node.Resources()
    const fontDictObj = resources?.lookup(PDFName.of('Font'))
    let fontObj: PDFDict | null = null

    if (fontDictObj instanceof PDFDict) {
      const ref = fontDictObj.lookup(PDFName.of(cleanName))
      const resolved = ref ? this.doc.context.lookup(ref) : null
      if (resolved instanceof PDFDict) {
        fontObj = resolved
      }
    }

    if (!fontObj) {
      const fallback: FontMetrics = {
        subtype: 'unknown',
        approximate: true,
        isType3: false,
        getGlyphWidth: () => 500,
        isDoubleByte: false,
      }
      this.cache.set(cleanName, fallback)
      return fallback
    }

    const subtype = fontObj.lookup(PDFName.of('Subtype'))?.toString() || ''

    if (subtype === '/Type3') {
      const type3Metrics: FontMetrics = {
        subtype: '/Type3',
        approximate: true,
        isType3: true,
        getGlyphWidth: () => 500,
        isDoubleByte: false,
      }
      this.cache.set(cleanName, type3Metrics)
      return type3Metrics
    }

    if (subtype === '/Type0') {
      // Composite font: CIDFontDescendant
      const descFonts = fontObj.lookup(PDFName.of('DescendantFonts'))
      let cidFont: PDFDict | null = null
      if (descFonts instanceof PDFArray && descFonts.size() > 0) {
        const resolvedCid = this.doc.context.lookup(descFonts.get(0))
        if (resolvedCid instanceof PDFDict) cidFont = resolvedCid
      }

      let dw = 1000
      const dwObj = cidFont?.lookup(PDFName.of('DW'))
      if (dwObj instanceof PDFNumber) dw = dwObj.asNumber()

      const widthMap = new Map<number, number>()
      const wObj = cidFont?.lookup(PDFName.of('W'))
      if (wObj instanceof PDFArray) {
        const arr = wObj.asArray()
        let i = 0
        while (i < arr.length) {
          const first = arr[i]
          if (first instanceof PDFNumber) {
            const startCid = first.asNumber()
            const second = arr[i + 1]
            if (second instanceof PDFArray) {
              const widths = second.asArray()
              for (let j = 0; j < widths.length; j++) {
                const w = widths[j]
                if (w instanceof PDFNumber) {
                  widthMap.set(startCid + j, w.asNumber())
                }
              }
              i += 2
            } else if (second instanceof PDFNumber && i + 2 < arr.length) {
              const endCid = second.asNumber()
              const widthVal = arr[i + 2]
              if (widthVal instanceof PDFNumber) {
                const w = widthVal.asNumber()
                for (let c = startCid; c <= endCid; c++) {
                  widthMap.set(c, w)
                }
              }
              i += 3
            } else {
              i++
            }
          } else {
            i++
          }
        }
      }

      const metrics: FontMetrics = {
        subtype: '/Type0',
        approximate: false,
        isType3: false,
        getGlyphWidth: (cid: number) => (widthMap.has(cid) ? widthMap.get(cid)! : dw),
        isDoubleByte: true,
      }
      this.cache.set(cleanName, metrics)
      return metrics
    }

    // Simple Font: Type1 / TrueType
    const firstCharObj = fontObj.lookup(PDFName.of('FirstChar'))
    const widthsObj = fontObj.lookup(PDFName.of('Widths'))
    if (firstCharObj instanceof PDFNumber && widthsObj instanceof PDFArray) {
      const firstChar = firstCharObj.asNumber()
      const widths = widthsObj.asArray()
      const widthsMap = new Map<number, number>()
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i]
        if (w instanceof PDFNumber) {
          widthsMap.set(firstChar + i, w.asNumber())
        }
      }
      const metrics: FontMetrics = {
        subtype,
        approximate: false,
        isType3: false,
        getGlyphWidth: (code: number) => widthsMap.get(code) || 500,
        isDoubleByte: false,
      }
      this.cache.set(cleanName, metrics)
      return metrics
    }

    // Check Standard 14 font by BaseFont
    const baseFont = fontObj.lookup(PDFName.of('BaseFont'))?.toString() || ''
    const match = /(Helvetica|Times|Courier)/i.exec(baseFont)
    if (match && standardFontEmbedderMod) {
      try {
        let stdFamily = 'Helvetica'
        if (/Times/i.test(baseFont)) stdFamily = 'Times-Roman'
        else if (/Courier/i.test(baseFont)) stdFamily = 'Courier'

        if (/Bold/i.test(baseFont) && /Italic|Oblique/i.test(baseFont)) {
          stdFamily = stdFamily.replace('-Roman', '') + (stdFamily === 'Times-Roman' ? '-BoldItalic' : '-BoldOblique')
        } else if (/Bold/i.test(baseFont)) {
          stdFamily = stdFamily.replace('-Roman', '') + '-Bold'
        } else if (/Italic|Oblique/i.test(baseFont)) {
          stdFamily = stdFamily.replace('-Roman', '') + (stdFamily === 'Times-Roman' ? '-Italic' : '-Oblique')
        }

        const embedder = standardFontEmbedderMod.for(stdFamily)
        const metrics: FontMetrics = {
          subtype,
          approximate: false,
          isType3: false,
          getGlyphWidth: (code: number) => {
            const ch = String.fromCharCode(code)
            try {
              return embedder.widthOfGlyph(ch) || 500
            } catch {
              return 500
            }
          },
          isDoubleByte: false,
        }
        this.cache.set(cleanName, metrics)
        return metrics
      } catch {
        // fallback
      }
    }

    const fallback: FontMetrics = {
      subtype,
      approximate: true,
      isType3: false,
      getGlyphWidth: () => 500,
      isDoubleByte: false,
    }
    this.cache.set(cleanName, fallback)
    return fallback
  }
}

export function computeTextAdvanceAndBbox(
  textBytes: Uint8Array,
  metrics: FontMetrics,
  fontSize: number,
  charSpace: number,
  wordSpace: number,
  hScale: number,
  textRise: number,
  tm: [number, number, number, number, number, number],
  ctm: [number, number, number, number, number, number],
): { advancePt: number; bbox: Rect } {
  let advanceEm = 0

  if (metrics.isDoubleByte) {
    for (let i = 0; i < textBytes.length; i += 2) {
      const cid = (textBytes[i] << 8) | (textBytes[i + 1] || 0)
      const w = metrics.getGlyphWidth(cid)
      advanceEm += w
    }
  } else {
    for (let i = 0; i < textBytes.length; i++) {
      const b = textBytes[i]
      const w = metrics.getGlyphWidth(b)
      advanceEm += w
    }
  }

  const numChars = metrics.isDoubleByte ? Math.floor(textBytes.length / 2) : textBytes.length
  let totalAdvancePt = (advanceEm / 1000) * fontSize
  totalAdvancePt += numChars * charSpace

  if (!metrics.isDoubleByte && wordSpace !== 0) {
    let spaces = 0
    for (let i = 0; i < textBytes.length; i++) {
      if (textBytes[i] === 0x20) spaces++
    }
    totalAdvancePt += spaces * wordSpace
  }

  totalAdvancePt *= hScale / 100

  // Bounding box in text space:
  // Baseline is at y = textRise. Ascent ~0.8 * fontSize, descent ~ -0.2 * fontSize.
  const yAsc = textRise + 0.8 * fontSize
  const yDesc = textRise - 0.2 * fontSize

  const p1 = applyMatrix(applyMatrix({ x: 0, y: yDesc }, tm), ctm)
  const p2 = applyMatrix(applyMatrix({ x: totalAdvancePt, y: yDesc }, tm), ctm)
  const p3 = applyMatrix(applyMatrix({ x: totalAdvancePt, y: yAsc }, tm), ctm)
  const p4 = applyMatrix(applyMatrix({ x: 0, y: yAsc }, tm), ctm)

  const minX = Math.min(p1.x, p2.x, p3.x, p4.x)
  const maxX = Math.max(p1.x, p2.x, p3.x, p4.x)
  const minY = Math.min(p1.y, p2.y, p3.y, p4.y)
  const maxY = Math.max(p1.y, p2.y, p3.y, p4.y)

  return {
    advancePt: totalAdvancePt,
    bbox: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
  }
}

export function inspectFormXObject(
  doc: PDFDocument,
  pageIndex: number,
  xobjName: string,
  ctm: [number, number, number, number, number, number],
): Rect | null {
  const cleanName = xobjName.startsWith('/') ? xobjName.slice(1) : xobjName
  const page = doc.getPage(pageIndex)
  const res = page.node.Resources()
  const xobjDict = res?.lookup(PDFName.of('XObject'))
  if (!(xobjDict instanceof PDFDict)) return null

  const ref = xobjDict.lookup(PDFName.of(cleanName))
  if (!ref) return null
  const obj = doc.context.lookup(ref)
  if (!(obj instanceof PDFRawStream || obj instanceof PDFDict)) return null

  const dict = obj instanceof PDFRawStream ? obj.dict : obj
  const subtype = dict.lookup(PDFName.of('Subtype'))?.toString()
  if (subtype !== '/Form') return null

  const bboxArr = dict.lookup(PDFName.of('BBox'))
  if (!(bboxArr instanceof PDFArray) || bboxArr.size() < 4) return null

  const x0 = (bboxArr.get(0) as PDFNumber).asNumber()
  const y0 = (bboxArr.get(1) as PDFNumber).asNumber()
  const x1 = (bboxArr.get(2) as PDFNumber).asNumber()
  const y1 = (bboxArr.get(3) as PDFNumber).asNumber()

  const p1 = applyMatrix({ x: x0, y: y0 }, ctm)
  const p2 = applyMatrix({ x: x1, y: y0 }, ctm)
  const p3 = applyMatrix({ x: x1, y: y1 }, ctm)
  const p4 = applyMatrix({ x: x0, y: y1 }, ctm)

  const minX = Math.min(p1.x, p2.x, p3.x, p4.x)
  const maxX = Math.max(p1.x, p2.x, p3.x, p4.x)
  const minY = Math.min(p1.y, p2.y, p3.y, p4.y)
  const maxY = Math.max(p1.y, p2.y, p3.y, p4.y)

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}
