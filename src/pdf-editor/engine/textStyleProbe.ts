import { PDFDocument, PDFName, PDFDict, PDFRef, PDFObject } from 'pdf-lib'
import { readPageContent } from './pageContent'
import { tokenizeContent } from './contentTokenizer'
import { multMatrix, computeTextAdvanceAndBbox, FontMetricsCache } from './textGeometry'
import type { Rect, ContentOp } from './types'

export interface TextStyleProbe {
  bbox: Rect // toạ độ PDF mặc định (pt), như engine W-7
  color?: string // '#rrggbb'; undefined khi không xác định
  baseFont?: string // BaseFont đã bỏ tiền tố subset 'ABCDEF+'
}

function toHex2(val: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(val * 255)))
  return clamped.toString(16).padStart(2, '0')
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
}

export function probeTextStyles(doc: PDFDocument, pageIndex: number): TextStyleProbe[] {
  try {
    const rawBytes = readPageContent(doc, pageIndex)
    if (!rawBytes || rawBytes.length === 0) {
      return []
    }

    let ops: ContentOp[]
    try {
      ops = tokenizeContent(rawBytes)
    } catch {
      return []
    }

    const fontCache = new FontMetricsCache(doc, pageIndex)
    const baseFontCache = new Map<string, string | undefined>()

    const resolveBaseFont = (fontResName: string): string | undefined => {
      const cleanName = fontResName.startsWith('/') ? fontResName.slice(1) : fontResName
      if (baseFontCache.has(cleanName)) {
        return baseFontCache.get(cleanName)
      }
      try {
        const page = doc.getPage(pageIndex)
        const resources = page.node.Resources()
        const fontDictObj = resources?.lookup(PDFName.of('Font'))
        let bf: string | undefined = undefined

        if (fontDictObj instanceof PDFDict) {
          let ref: PDFRef | PDFObject | undefined = undefined
          for (const [k, v] of fontDictObj.entries()) {
            if (k.asString().replace(/^\//, '') === cleanName) {
              ref = v
              break
            }
          }
          if (!ref) {
            ref = fontDictObj.lookup(PDFName.of(cleanName))
          }
          const resolved = ref ? doc.context.lookup(ref) : null
          if (resolved instanceof PDFDict) {
            const baseFontObj = resolved.lookup(PDFName.of('BaseFont'))
            if (baseFontObj instanceof PDFName) {
              const raw = baseFontObj.asString().replace(/^\//, '')
              bf = raw.replace(/^[A-Z]{6}\+/, '')
            }
          }
        }
        baseFontCache.set(cleanName, bf)
        return bf
      } catch {
        baseFontCache.set(cleanName, undefined)
        return undefined
      }
    }

    let ctm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
    const ctmStack: Array<[number, number, number, number, number, number]> = []

    let tm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
    let tlm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]

    let fillColor: string | undefined = '#000000'
    const colorStack: Array<string | undefined> = []

    let textRenderingMode = 0
    let fontResName = ''
    let fontSize = 12
    let leading = 0
    let charSpace = 0
    let wordSpace = 0
    let hScale = 100
    let textRise = 0

    const probes: TextStyleProbe[] = []

    for (let opIdx = 0; opIdx < ops.length; opIdx++) {
      const op = ops[opIdx]
      const name = op.operator

      // Graphics state
      if (name === 'q') {
        ctmStack.push([...ctm])
        colorStack.push(fillColor)
        continue
      }

      if (name === 'Q') {
        if (ctmStack.length > 0) ctm = ctmStack.pop()!
        if (colorStack.length > 0) fillColor = colorStack.pop()
        continue
      }

      if (name === 'cm') {
        if (op.operands.length >= 6) {
          const a = (op.operands[0] as { value: number }).value
          const b = (op.operands[1] as { value: number }).value
          const c = (op.operands[2] as { value: number }).value
          const d = (op.operands[3] as { value: number }).value
          const e = (op.operands[4] as { value: number }).value
          const f = (op.operands[5] as { value: number }).value
          ctm = multMatrix([a, b, c, d, e, f], ctm)
        }
        continue
      }

      // Color state (fill)
      if (name === 'g') {
        if (op.operands.length >= 1 && op.operands[0].type === 'number') {
          const val = op.operands[0].value
          fillColor = rgbToHex(val, val, val)
        }
        continue
      }

      if (name === 'rg') {
        if (
          op.operands.length >= 3 &&
          op.operands[0].type === 'number' &&
          op.operands[1].type === 'number' &&
          op.operands[2].type === 'number'
        ) {
          const r = op.operands[0].value
          const g = op.operands[1].value
          const b = op.operands[2].value
          fillColor = rgbToHex(r, g, b)
        }
        continue
      }

      if (name === 'k') {
        if (op.operands.length >= 4 && op.operands.every((o) => o.type === 'number')) {
          const c = (op.operands[0] as { value: number }).value
          const m = (op.operands[1] as { value: number }).value
          const y = (op.operands[2] as { value: number }).value
          const k = (op.operands[3] as { value: number }).value
          const r = (1 - c) * (1 - k)
          const g = (1 - m) * (1 - k)
          const b = (1 - y) * (1 - k)
          fillColor = rgbToHex(r, g, b)
        }
        continue
      }

      if (name === 'sc' || name === 'scn') {
        const allNumbers = op.operands.every((o) => o.type === 'number')
        if (!allNumbers || op.operands.length === 0) {
          fillColor = undefined
        } else if (op.operands.length === 1) {
          const val = (op.operands[0] as { value: number }).value
          fillColor = rgbToHex(val, val, val)
        } else if (op.operands.length === 3) {
          const r = (op.operands[0] as { value: number }).value
          const g = (op.operands[1] as { value: number }).value
          const b = (op.operands[2] as { value: number }).value
          fillColor = rgbToHex(r, g, b)
        } else if (op.operands.length === 4) {
          const c = (op.operands[0] as { value: number }).value
          const m = (op.operands[1] as { value: number }).value
          const y = (op.operands[2] as { value: number }).value
          const k = (op.operands[3] as { value: number }).value
          const r = (1 - c) * (1 - k)
          const g = (1 - m) * (1 - k)
          const b = (1 - y) * (1 - k)
          fillColor = rgbToHex(r, g, b)
        } else {
          fillColor = undefined
        }
        continue
      }

      // Text state
      if (name === 'BT') {
        tm = [1, 0, 0, 1, 0, 0]
        tlm = [1, 0, 0, 1, 0, 0]
        continue
      }

      if (name === 'ET') {
        continue
      }

      if (name === 'Tf') {
        if (op.operands.length >= 2) {
          fontResName = (op.operands[0] as { value: string }).value
          fontSize = (op.operands[1] as { value: number }).value
        }
        continue
      }

      if (name === 'TL') {
        if (op.operands.length >= 1) {
          leading = (op.operands[0] as { value: number }).value
        }
        continue
      }

      if (name === 'Tc') {
        if (op.operands.length >= 1) {
          charSpace = (op.operands[0] as { value: number }).value
        }
        continue
      }

      if (name === 'Tw') {
        if (op.operands.length >= 1) {
          wordSpace = (op.operands[0] as { value: number }).value
        }
        continue
      }

      if (name === 'Tz') {
        if (op.operands.length >= 1) {
          hScale = (op.operands[0] as { value: number }).value
        }
        continue
      }

      if (name === 'Ts') {
        if (op.operands.length >= 1) {
          textRise = (op.operands[0] as { value: number }).value
        }
        continue
      }

      if (name === 'Tr') {
        if (op.operands.length >= 1 && op.operands[0].type === 'number') {
          textRenderingMode = op.operands[0].value
        }
        continue
      }

      // Text positioning
      if (name === 'Td') {
        if (op.operands.length >= 2) {
          const tx = (op.operands[0] as { value: number }).value
          const ty = (op.operands[1] as { value: number }).value
          tlm = multMatrix([1, 0, 0, 1, tx, ty], tlm)
          tm = [...tlm]
        }
        continue
      }

      if (name === 'TD') {
        if (op.operands.length >= 2) {
          const tx = (op.operands[0] as { value: number }).value
          const ty = (op.operands[1] as { value: number }).value
          leading = -ty
          tlm = multMatrix([1, 0, 0, 1, tx, ty], tlm)
          tm = [...tlm]
        }
        continue
      }

      if (name === 'Tm') {
        if (op.operands.length >= 6) {
          const a = (op.operands[0] as { value: number }).value
          const b = (op.operands[1] as { value: number }).value
          const c = (op.operands[2] as { value: number }).value
          const d = (op.operands[3] as { value: number }).value
          const e = (op.operands[4] as { value: number }).value
          const f = (op.operands[5] as { value: number }).value
          tm = [a, b, c, d, e, f]
          tlm = [a, b, c, d, e, f]
        }
        continue
      }

      if (name === 'T*') {
        tlm = multMatrix([1, 0, 0, 1, 0, -leading], tlm)
        tm = [...tlm]
        continue
      }

      // XObject Do (Do not traverse Form XObjects)
      if (name === 'Do') {
        continue
      }

      // Text showing: Tj, ', ", TJ
      const Th = hScale / 100
      const isZeroScale = fontSize === 0 || Th === 0

      if (name === 'Tj') {
        if (op.operands.length >= 1 && op.operands[0].type === 'string') {
          const metrics = fontCache.getFontMetrics(fontResName)
          const { advancePt, bbox } = computeTextAdvanceAndBbox(
            op.operands[0].bytes,
            metrics,
            fontSize,
            charSpace,
            wordSpace,
            hScale,
            textRise,
            tm,
            ctm,
          )

          if (textRenderingMode !== 3 && !isZeroScale) {
            probes.push({
              bbox,
              color: fillColor,
              baseFont: resolveBaseFont(fontResName),
            })
          }

          tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
        }
        continue
      }

      if (name === "'") {
        tlm = multMatrix([1, 0, 0, 1, 0, -leading], tlm)
        tm = [...tlm]

        if (op.operands.length >= 1 && op.operands[0].type === 'string') {
          const metrics = fontCache.getFontMetrics(fontResName)
          const { advancePt, bbox } = computeTextAdvanceAndBbox(
            op.operands[0].bytes,
            metrics,
            fontSize,
            charSpace,
            wordSpace,
            hScale,
            textRise,
            tm,
            ctm,
          )

          if (textRenderingMode !== 3 && !isZeroScale) {
            probes.push({
              bbox,
              color: fillColor,
              baseFont: resolveBaseFont(fontResName),
            })
          }

          tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
        }
        continue
      }

      if (name === '"') {
        if (op.operands.length >= 3) {
          wordSpace = (op.operands[0] as { value: number }).value
          charSpace = (op.operands[1] as { value: number }).value
          tlm = multMatrix([1, 0, 0, 1, 0, -leading], tlm)
          tm = [...tlm]

          if (op.operands[2].type === 'string') {
            const metrics = fontCache.getFontMetrics(fontResName)
            const { advancePt, bbox } = computeTextAdvanceAndBbox(
              op.operands[2].bytes,
              metrics,
              fontSize,
              charSpace,
              wordSpace,
              hScale,
              textRise,
              tm,
              ctm,
            )

            if (textRenderingMode !== 3 && !isZeroScale) {
              probes.push({
                bbox,
                color: fillColor,
                baseFont: resolveBaseFont(fontResName),
              })
            }

            tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
          }
        }
        continue
      }

      if (name === 'TJ') {
        if (op.operands.length >= 1 && op.operands[0].type === 'array') {
          const arr = op.operands[0].value
          const metrics = fontCache.getFontMetrics(fontResName)
          let minX = Infinity
          let minY = Infinity
          let maxX = -Infinity
          let maxY = -Infinity
          let hasString = false

          for (let i = 0; i < arr.length; i++) {
            const el = arr[i]
            if (el.type === 'number') {
              const dispPt = -(el.value / 1000) * fontSize * Th
              tm = multMatrix([1, 0, 0, 1, dispPt, 0], tm)
            } else if (el.type === 'string') {
              const { advancePt, bbox } = computeTextAdvanceAndBbox(
                el.bytes,
                metrics,
                fontSize,
                charSpace,
                wordSpace,
                hScale,
                textRise,
                tm,
                ctm,
              )
              tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
              if (bbox.width > 0 || bbox.height > 0) {
                hasString = true
                minX = Math.min(minX, bbox.x)
                minY = Math.min(minY, bbox.y)
                maxX = Math.max(maxX, bbox.x + bbox.width)
                maxY = Math.max(maxY, bbox.y + bbox.height)
              }
            }
          }

          if (textRenderingMode !== 3 && !isZeroScale && hasString) {
            probes.push({
              bbox: {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
              },
              color: fillColor,
              baseFont: resolveBaseFont(fontResName),
            })
          }
        }
        continue
      }
    }

    return probes
  } catch {
    return []
  }
}
