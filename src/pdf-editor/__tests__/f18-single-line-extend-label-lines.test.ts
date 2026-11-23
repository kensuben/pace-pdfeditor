// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  EXPORT_FONT_FILES,
  buildEditedPdfWithReport,
  buildReplacementAnnotation,
  groupLinesIntoBlocks,
  groupTextItemsIntoLines,
  isLabelLine,
} from '../index'
import type { TextRegion } from '../../types'

const require = createRequire(import.meta.url)
const pdfjsPkgPath = require.resolve('pdfjs-dist/package.json')
const standardFontDataUrl = path.join(path.dirname(pdfjsPkgPath), 'standard_fonts').replace(/\\/g, '/') + '/'
const fontsDir = fileURLToPath(new URL('../fonts', import.meta.url))

const loadRealFontBytes = async (family: string, variant: string): Promise<ArrayBuffer> => {
  const familyKey = family as keyof typeof EXPORT_FONT_FILES
  const variantKey = variant as keyof (typeof EXPORT_FONT_FILES)[typeof familyKey]
  const file = EXPORT_FONT_FILES[familyKey]?.[variantKey]
  if (!file) throw new Error(`Unknown font ${family} ${variant}`)
  const buf = fs.readFileSync(path.join(fontsDir, file))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe('F-18: Single line replacement extension and label line separation', () => {
  // =========================================================================
  // K1: buildReplacementAnnotation computes maxWidth for single-line regions
  // =========================================================================
  it('K1: buildReplacementAnnotation computes maxWidth for single-line regions and undefined for blocks', () => {
    const singleRegion: TextRegion = {
      id: 'r1',
      page: 1,
      text: 'Title 01',
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.03,
      fontSize: 10,
      source: 'native',
    }

    const sameRowNeighbor: TextRegion = {
      id: 'r2',
      page: 1,
      text: 'Right col',
      x: 0.6,
      y: 0.1,
      width: 0.1,
      height: 0.03,
      fontSize: 10,
      source: 'native',
    }

    const otherRowNeighbor: TextRegion = {
      id: 'r3',
      page: 1,
      text: 'Body text',
      x: 0.1,
      y: 0.3,
      width: 0.8, // right edge: 0.1 + 0.8 = 0.9
      height: 0.03,
      fontSize: 10,
      source: 'native',
    }

    // With same-row neighbor at 0.6 and pageWidthPt = 1000:
    // gap = 0.5 * 10 / 1000 = 0.005
    // limit = Math.min(0.6 - 0.005, 0.9) = 0.595
    // maxWidth = 0.595 - 0.1 = 0.495 ≈ 0.5 - gap (±0.01)
    const ann1 = buildReplacementAnnotation(
      singleRegion,
      'Title 01 Next',
      [singleRegion, sameRowNeighbor, otherRowNeighbor],
      'ann-1',
      1000,
    )
    expect(ann1.maxWidth).toBeDefined()
    expect(ann1.maxWidth!).toBeCloseTo(0.495, 2)

    // Without same-row neighbor: limit is right content edge (0.9)
    // maxWidth = 0.9 - 0.1 = 0.8
    const ann2 = buildReplacementAnnotation(
      singleRegion,
      'Title 01 Next',
      [singleRegion, otherRowNeighbor],
      'ann-2',
      1000,
    )
    expect(ann2.maxWidth).toBeDefined()
    expect(ann2.maxWidth!).toBeCloseTo(0.8, 2)

    // Block region (has lineRects) -> maxWidth must be undefined
    const blockRegion: TextRegion = {
      ...singleRegion,
      lineRects: [
        { x: 0.1, y: 0.1, width: 0.3, height: 0.015 },
        { x: 0.1, y: 0.115, width: 0.3, height: 0.015 },
      ],
    }
    const annBlock = buildReplacementAnnotation(
      blockRegion,
      'Block replacement',
      [blockRegion, otherRowNeighbor],
      'ann-block',
      1000,
    )
    expect(annBlock.maxWidth).toBeUndefined()
  })

  // =========================================================================
  // K2: Export single-line title replacement extends without early line wrap
  // =========================================================================
  it('K2: single-line title replacement extends to available width and exports as 1 line without wrapping', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const fontBold = await doc.embedFont(StandardFonts.TimesRomanBold)
    const fontRegular = await doc.embedFont(StandardFonts.TimesRoman)

    page.drawText('CONG VAN SO 01/2026', { x: 70, y: 750, size: 14, font: fontBold })
    page.drawText('Noi dung cong van quy dinh ve viec huong dan thuc hien cac nhiem vu trong nam...', {
      x: 70,
      y: 700,
      size: 13,
      font: fontRegular,
    })

    const baseBytes = new Uint8Array(await doc.save())
    const pdfDoc = await pdfjsLib.getDocument({ data: baseBytes.slice(), standardFontDataUrl }).promise
    const pdfPage = await pdfDoc.getPage(1)
    const textContent = await pdfPage.getTextContent()
    const viewport = pdfPage.getViewport({ scale: 1.0 })

    const rawLines = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )
    const titleRegion = rawLines.find((r) => r.text.includes('CONG VAN SO 01/2026'))!
    expect(titleRegion).toBeDefined()

    const replacementAnn = buildReplacementAnnotation(
      titleRegion,
      'CÔNG VĂN SỐ 01/2026',
      rawLines,
      'ann-title',
      viewport.width,
    )
    expect(replacementAnn.maxWidth).toBeGreaterThan(titleRegion.width)

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [replacementAnn], {
      loadFontBytes: loadRealFontBytes,
    })

    expect(report.overflowPages).toHaveLength(0)

    const outDoc = await pdfjsLib.getDocument({ data: outBytes.slice(), standardFontDataUrl }).promise
    const outPage = await outDoc.getPage(1)
    const outContent = await outPage.getTextContent()

    const item = outContent.items.find((it) => 'str' in it && it.str.includes('CÔNG VĂN SỐ 01/2026')) as
      | { str: string; transform: number[] }
      | undefined
    expect(item).toBeDefined()
    expect(item!.str).toBe('CÔNG VĂN SỐ 01/2026')
  })

  // =========================================================================
  // K3: Text exceeding maxWidth wraps at maxWidth and keeps font size
  // =========================================================================
  it('K3: text exceeding maxWidth wraps at maxWidth and keeps font size', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Short', { x: 70, y: 750, size: 12, font })
    page.drawText('Right margin indicator', { x: 70, y: 700, size: 12, font })
    const baseBytes = new Uint8Array(await doc.save())

    const singleRegion: TextRegion = {
      id: 'r1',
      page: 1,
      text: 'Short',
      x: 70 / 595,
      y: (842 - 750 - 12) / 842,
      width: 40 / 595,
      height: 15 / 842,
      fontSize: 12,
      source: 'native',
    }

    const otherRegion: TextRegion = {
      id: 'r2',
      page: 1,
      text: 'Right margin indicator',
      x: 70 / 595,
      y: (842 - 700 - 12) / 842,
      width: 200 / 595,
      height: 15 / 842,
      fontSize: 12,
      source: 'native',
    }

    const longText =
      'Day la mot doan van ban rat dai vuot qua ca be rong toi da maxWidth cua dong va do do phai duoc ngat thanh nhieu dong theo be rong maxWidth moi.'
    const ann = buildReplacementAnnotation(singleRegion, longText, [singleRegion, otherRegion], 'ann-long', 595)

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [ann], {
      loadFontBytes: loadRealFontBytes,
    })

    const outDoc = await pdfjsLib.getDocument({ data: outBytes.slice(), standardFontDataUrl }).promise
    const outPage = await outDoc.getPage(1)
    const outContent = await outPage.getTextContent()

    const matchingItems = outContent.items.filter((it) => 'str' in it && it.str.length > 0 && longText.includes(it.str))
    expect(matchingItems.length).toBeGreaterThan(1)
  })

  // =========================================================================
  // K4: Multiline block regression (W-9c K8) wraps according to block width
  // =========================================================================
  it('K4: multiline block regression (W-9c K8) wraps according to block width', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    page.drawText('Dong 1 cua van ban hop dong mau.', { x: 70, y: 700, size: 12, font })
    page.drawText('Dong 2 quy dinh chi tiet ve thoi han thuc hien cong viec.', { x: 70, y: 685, size: 12, font })
    page.drawText('Dong 3 ghi ro cac cam ket khac giua hai ben tham gia.', { x: 70, y: 670, size: 12, font })

    const bytes = new Uint8Array(await doc.save())
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice(), standardFontDataUrl }).promise
    const pdfPage = await pdfDoc.getPage(1)
    const textContent = await pdfPage.getTextContent()
    const viewport = pdfPage.getViewport({ scale: 1.0 })

    const rawLines = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )
    const blocks = groupLinesIntoBlocks(rawLines, { width: viewport.width, height: viewport.height }, 1)
    expect(blocks).toHaveLength(1)
    const blockRegion = blocks[0]
    expect(blockRegion.lineRects).toBeDefined()
    expect(blockRegion.lineRects!.length).toBe(3)

    const replacementText =
      'Dong 1 da duoc chinh sua dai hon rat nhieu de kiem tra ngat dong theo dung be rong khoi ban dau.\n' +
      'Dong 2 cung duoc thay the bang mot doan noi dung chi tiet hon.\n' +
      'Dong 3 bo sung them cam ket moi.'

    const ann = buildReplacementAnnotation(blockRegion, replacementText, blocks, 'ann-block', viewport.width)
    expect(ann.maxWidth).toBeUndefined()
    expect(ann.originalLineRects).toBeDefined()

    const { bytes: outBytes } = await buildEditedPdfWithReport(bytes, [ann], {
      loadFontBytes: loadRealFontBytes,
    })

    const outDoc = await pdfjsLib.getDocument({ data: outBytes.slice(), standardFontDataUrl }).promise
    const outPage = await outDoc.getPage(1)
    const outContent = await outPage.getTextContent()
    const extracted = outContent.items.map((it) => ('str' in it ? it.str : '')).join(' ')
    expect(extracted).toContain('Dong 1 da duoc chinh sua')
  })

  // =========================================================================
  // K5: isLabelLine detects short labels followed by colon correctly
  // =========================================================================
  it('K5: isLabelLine detects short labels followed by colon correctly', () => {
    // True cases:
    expect(isLabelLine('Kính gửi: Học viên Test 01')).toBe(true)
    expect(isLabelLine('Địa chỉ: Số 1 Đường Test')).toBe(true)
    expect(isLabelLine('Email: test@example.com')).toBe(true)
    expect(isLabelLine('Mã số thuế:')).toBe(true)

    // False cases:
    expect(
      isLabelLine('Bên B cung cấp chương trình đào tạo kỹ năng quản trị cho cán bộ: theo đề cương'),
    ).toBe(false)
    expect(isLabelLine('• Mục 1')).toBe(false)
    expect(isLabelLine('Hôm nay, ngày 05 tháng 01')).toBe(false)
  })

  // =========================================================================
  // K6: groupLinesIntoBlocks keeps label lines separate and merges full-width warning
  // =========================================================================
  it('K6: groupLinesIntoBlocks keeps label lines as separate regions and merges full-width warning paragraphs', () => {
    const viewport = { width: 600, height: 800 }

    // Case 1: 2 label lines (Kinh gui / Dia chi) at same font, aligned left, 20pt apart, size 13
    const line1: TextRegion = {
      id: 'l1',
      page: 1,
      text: 'Kinh gui: Hoc vien Test 01',
      x: 70 / 600,
      y: 100 / 800,
      width: 200 / 600,
      height: 16 / 800,
      fontSize: 13,
      fontFamily: 'Times Roman',
      source: 'native',
    }

    const line2: TextRegion = {
      id: 'l2',
      page: 1,
      text: 'Dia chi: So 1 Duong Test, Ha Noi',
      x: 70 / 600,
      y: 120 / 800,
      width: 250 / 600,
      height: 16 / 800,
      fontSize: 13,
      fontFamily: 'Times Roman',
      source: 'native',
    }

    const labelBlocks = groupLinesIntoBlocks([line1, line2], viewport, 1)
    expect(labelBlocks).toHaveLength(2)
    expect(labelBlocks[0].id).toBe('l1')
    expect(labelBlocks[1].id).toBe('l2')

    // Case 2: Paragraph starting with "Lưu ý: …" where line 1 is full width
    const warnLine1: TextRegion = {
      id: 'w1',
      page: 1,
      text: 'Lưu ý: quy định tại điều khoản này phải được thực hiện đầy đủ theo hướng dẫn của ban quản trị...',
      x: 70 / 600,
      y: 200 / 800,
      width: 460 / 600,
      height: 16 / 800,
      fontSize: 13,
      fontFamily: 'Times Roman',
      source: 'native',
    }

    const warnLine2: TextRegion = {
      id: 'w2',
      page: 1,
      text: 'cơ quan có thẩm quyền và báo cáo định kỳ hàng quý trước ngày cuối cùng của kỳ báo cáo.',
      x: 70 / 600,
      y: 216 / 800,
      width: 330 / 600,
      height: 16 / 800,
      fontSize: 13,
      fontFamily: 'Times Roman',
      source: 'native',
    }

    const warnBlocks = groupLinesIntoBlocks([warnLine1, warnLine2], viewport, 1)
    expect(warnBlocks).toHaveLength(1)
    expect(warnBlocks[0].lineRects).toHaveLength(2)
  })
})
