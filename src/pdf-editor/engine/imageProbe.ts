import type { PDFDocument } from 'pdf-lib'
import { PDFDict, PDFName, PDFRawStream, PDFStream } from 'pdf-lib'
import type { Rect } from './types'
import { tokenizeContent } from './contentTokenizer'
import { readPageContent } from './pageContent'
import { multMatrix, applyMatrix } from './textGeometry'

export interface PageImageInfo {
  resourceName: string      // Tên trong /Resources/XObject (vd 'Im1', bỏ leading slash '/')
  occurrence: number        // 0-based index của lần xuất hiện resourceName này trên trang
  ctm: [number, number, number, number, number, number] // CTM tại thời điểm gọi Do
  bbox: Rect                // Bbox tính được từ [0, 0, 1, 1] qua CTM (PDF user space pt)
  axisAligned: boolean      // true nếu CTM không quay nghiêng (chỉ cho phép scale + translate)
}

export function probePageImages(
  doc: PDFDocument,
  pageIndex: number,
): { images: PageImageInfo[]; skipped: { formXObject: number; inline: number } } {
  try {
    const pageCount = doc.getPageCount()
    if (pageIndex < 0 || pageIndex >= pageCount) {
      return { images: [], skipped: { formXObject: 0, inline: 0 } }
    }

    const bytes = readPageContent(doc, pageIndex)
    if (bytes.length === 0) {
      return { images: [], skipped: { formXObject: 0, inline: 0 } }
    }

    const ops = tokenizeContent(bytes)
    const page = doc.getPage(pageIndex)
    const res = page.node.Resources()
    const resolvedRes = res instanceof PDFDict ? res : res ? doc.context.lookup(res) : null
    const xobjDictRaw = resolvedRes instanceof PDFDict ? resolvedRes.lookup(PDFName.of('XObject')) : null
    const xobjDict = xobjDictRaw instanceof PDFDict ? xobjDictRaw : xobjDictRaw ? doc.context.lookup(xobjDictRaw) : null

    let ctm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
    const ctmStack: Array<[number, number, number, number, number, number]> = []
    const occMap = new Map<string, number>()
    const images: PageImageInfo[] = []
    const skipped = { formXObject: 0, inline: 0 }

    for (const op of ops) {
      const name = op.operator

      if (name === 'q') {
        ctmStack.push([...ctm])
        continue
      }

      if (name === 'Q') {
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop()!
        }
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

      if (name === 'BI') {
        skipped.inline++
        continue
      }

      if (name === 'Do') {
        if (op.operands.length < 1 || op.operands[0].type !== 'name') continue
        const rawName = op.operands[0].value
        const cleanName = rawName.startsWith('/') ? rawName.slice(1) : rawName

        if (!(xobjDict instanceof PDFDict)) continue
        const ref = xobjDict.lookup(PDFName.of(cleanName))
        if (!ref) continue
        const obj = doc.context.lookup(ref)
        if (!obj) continue

        const dict = (obj instanceof PDFRawStream || obj instanceof PDFStream)
          ? (obj as PDFStream).dict
          : obj instanceof PDFDict
            ? obj
            : null
        if (!dict) continue

        const subtype = dict.lookup(PDFName.of('Subtype'))?.toString()
        if (subtype === '/Form') {
          skipped.formXObject++
          continue
        }

        if (subtype === '/Image') {
          const occurrence = occMap.get(cleanName) || 0
          occMap.set(cleanName, occurrence + 1)

          const p1 = applyMatrix({ x: 0, y: 0 }, ctm)
          const p2 = applyMatrix({ x: 1, y: 0 }, ctm)
          const p3 = applyMatrix({ x: 1, y: 1 }, ctm)
          const p4 = applyMatrix({ x: 0, y: 1 }, ctm)

          const minX = Math.min(p1.x, p2.x, p3.x, p4.x)
          const maxX = Math.max(p1.x, p2.x, p3.x, p4.x)
          const minY = Math.min(p1.y, p2.y, p3.y, p4.y)
          const maxY = Math.max(p1.y, p2.y, p3.y, p4.y)

          const [a, b, c, d] = ctm
          const maxScale = Math.max(Math.abs(a), Math.abs(d))
          const axisAligned =
            Math.abs(b) <= 1e-6 * maxScale &&
            Math.abs(c) <= 1e-6 * maxScale &&
            a > 0 &&
            d > 0

          images.push({
            resourceName: cleanName,
            occurrence,
            ctm: [...ctm],
            bbox: {
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
            },
            axisAligned,
          })
        }
      }
    }

    return { images, skipped }
  } catch {
    return { images: [], skipped: { formXObject: 0, inline: 0 } }
  }
}
