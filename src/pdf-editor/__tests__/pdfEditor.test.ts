// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation, TextRegion } from '../../types'
import {
  groupTextItemsIntoLines,
  parseOcrTsv,
  groupOcrWordsIntoLines,
} from '../textExtraction'
import { buildReplacementAnnotation } from '../textEdit'
import { buildEditedPdf } from '../exportPdf'
import { EXPORT_FONT_FILES } from '../fonts'
import {
  insertPdfPages,
  movePage,
  deletePage,
  remapAnnotationsOnInsert,
  remapAnnotationsOnMove,
  remapAnnotationsOnDelete,
} from '../pageOps'

const require = createRequire(import.meta.url)
const pdfjsPkgPath = require.resolve('pdfjs-dist/package.json')
const standardFontDataUrl = path.join(path.dirname(pdfjsPkgPath), 'standard_fonts').replace(/\\/g, '/') + '/'
const fontsDir = fileURLToPath(new URL('../fonts', import.meta.url))

async function getBaseFontNames(pdfBytes: Uint8Array): Promise<string[]> {
  const loaded = await PDFDocument.load(pdfBytes)
  const page = loaded.getPage(0)
  const fontDict = page.node.Resources()?.lookup(PDFName.of('Font'))
  if (!(fontDict instanceof PDFDict)) return []
  const names: string[] = []
  for (const ref of fontDict.values()) {
    const fontObj = ref instanceof PDFRef ? loaded.context.lookup(ref) : ref
    if (fontObj instanceof PDFDict) {
      const baseFont = fontObj.lookup(PDFName.of('BaseFont'))?.toString()
      if (baseFont) names.push(baseFont)
    }
  }
  return names
}

async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjsLib.getDocument({
    data: bytes.slice(),
    standardFontDataUrl,
  }).promise
  let fullText = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    fullText += pageText + '\n'
  }
  return fullText
}

const loadRealFontBytes = async (family: string, variant: string): Promise<ArrayBuffer> => {
  const familyKey = family as keyof typeof EXPORT_FONT_FILES
  const variantKey = variant as keyof (typeof EXPORT_FONT_FILES)[typeof familyKey]
  const file = EXPORT_FONT_FILES[familyKey]?.[variantKey]
  if (!file) throw new Error(`Unknown font ${family} ${variant}`)
  const buf = fs.readFileSync(path.join(fontsDir, file))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe('PDF Editor Modularized Unit Tests (W-6 & F-11)', () => {
  // T1: groupTextItemsIntoLines: 2 fragment cùng dòng, khoảng cách lớn → nối bằng 1 dấu cách; khoảng cách nhỏ → nối liền.
  it('T1: groupTextItemsIntoLines joins fragments with space for large gap and connects them for small gap', () => {
    const viewport = { transform: [1, 0, 0, 1, 0, 0], width: 600, height: 800 }
    const styles = { F1: { fontFamily: 'Helvetica' } }

    // Case A: large gap (> fontSize * 0.12 = 1.44px, and <= max(15px, 36px) = 36px)
    // frag1: x=50, width=30 -> right=80; frag2: x=90 -> gap=10px -> separator=' '
    const itemsLargeGap = [
      { str: 'Hello', transform: [1, 0, 0, 1, 50, 700], width: 30, height: 12, fontName: 'F1' },
      { str: 'World', transform: [1, 0, 0, 1, 90, 700], width: 30, height: 12, fontName: 'F1' },
    ]
    const linesLargeGap = groupTextItemsIntoLines(itemsLargeGap, styles, viewport, 1)
    expect(linesLargeGap).toHaveLength(1)
    expect(linesLargeGap[0].text).toBe('Hello World')

    // Case B: small gap (<= fontSize * 0.12 = 1.44px)
    // frag1: x=50, width=30 -> right=80; frag2: x=80.5 -> gap=0.5px -> separator=''
    const itemsSmallGap = [
      { str: 'Hello', transform: [1, 0, 0, 1, 50, 700], width: 30, height: 12, fontName: 'F1' },
      { str: 'World', transform: [1, 0, 0, 1, 80.5, 700], width: 30, height: 12, fontName: 'F1' },
    ]
    const linesSmallGap = groupTextItemsIntoLines(itemsSmallGap, styles, viewport, 1)
    expect(linesSmallGap).toHaveLength(1)
    expect(linesSmallGap[0].text).toBe('HelloWorld')
  })

  // T2: fragment khác font hoặc khác bold → 2 dòng riêng.
  it('T2: groupTextItemsIntoLines separates fragments into distinct lines if font or bold differs', () => {
    const viewport = { transform: [1, 0, 0, 1, 0, 0], width: 600, height: 800 }
    const styles = {
      F1: { fontFamily: 'Helvetica' },
      F2: { fontFamily: 'Times New Roman' },
    }

    // Different font
    const itemsDiffFont = [
      { str: 'First', transform: [1, 0, 0, 1, 50, 700], width: 30, height: 12, fontName: 'F1' },
      { str: 'Second', transform: [1, 0, 0, 1, 85, 700], width: 30, height: 12, fontName: 'F2' },
    ]
    const linesDiffFont = groupTextItemsIntoLines(itemsDiffFont, styles, viewport, 1)
    expect(linesDiffFont).toHaveLength(2)
    expect(linesDiffFont[0].text).toBe('First')
    expect(linesDiffFont[1].text).toBe('Second')

    // Different bold
    const itemsDiffBold = [
      { str: 'Normal', transform: [1, 0, 0, 1, 50, 700], width: 30, height: 12, fontName: 'F1' },
      { str: 'BoldText', transform: [1, 0, 0, 1, 85, 700], width: 30, height: 12, fontName: 'F1-Bold' },
    ]
    const linesDiffBold = groupTextItemsIntoLines(itemsDiffBold, styles, viewport, 1)
    expect(linesDiffBold).toHaveLength(2)
    expect(linesDiffBold[0].text).toBe('Normal')
    expect(linesDiffBold[1].text).toBe('BoldText')
  })

  // T3: fragment trùng (cùng chữ, lệch < 0.002) → chỉ giữ 1.
  it('T3: groupTextItemsIntoLines deduplicates fragments with identical text and delta < 0.002', () => {
    const viewport = { transform: [1, 0, 0, 1, 0, 0], width: 600, height: 800 }
    const styles = { F1: { fontFamily: 'Helvetica' } }

    const itemsWithDuplicate = [
      { str: 'PACE', transform: [1, 0, 0, 1, 60, 700], width: 30, height: 12, fontName: 'F1' },
      // Duplicate with delta x < 0.002 (60.5 / 600 = 0.10083 vs 60/600 = 0.1, delta = 0.00083 < 0.002)
      { str: 'PACE', transform: [1, 0, 0, 1, 60.5, 700.5], width: 30.2, height: 12, fontName: 'F1' },
    ]
    const lines = groupTextItemsIntoLines(itemsWithDuplicate, styles, viewport, 1)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('PACE')
  })

  // T4: parseOcrTsv: dòng level ≠ 5 bị bỏ; confidence < 35 bị bỏ; groupOcrWordsIntoLines gộp 2 từ cùng dòng, giữ confidence nhỏ nhất.
  it('T4: parseOcrTsv filters invalid levels/low confidence and groupOcrWordsIntoLines preserves minimum confidence', () => {
    const tsvData = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '4\t1\t1\t1\t1\t0\t10\t20\t100\t16\t90\tParagraph level text', // level != 5 -> dropped
      '5\t1\t1\t1\t1\t1\t10\t20\t40\t16\t25\tLowConfWord',           // conf < 35 -> dropped
      '5\t1\t1\t1\t1\t2\t10\t20\t40\t16\t85\tHọc',                  // valid word 1
      '5\t1\t1\t1\t1\t3\t55\t20\t40\t16\t60\tviên',                 // valid word 2
    ].join('\n')

    const words = parseOcrTsv(tsvData, 1, 600, 800, () => 'fixed-id')
    expect(words).toHaveLength(2)
    expect(words[0].text).toBe('Học')
    expect(words[0].confidence).toBe(85)
    expect(words[1].text).toBe('viên')
    expect(words[1].confidence).toBe(60)

    const lines = groupOcrWordsIntoLines(words, 1, () => 'fixed-id')
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Học viên')
    expect(lines[0].confidence).toBe(60)
  })

  // T5: buildReplacementAnnotation: có dòng phía trên rất sát → maskPadTop ≤ 25% khoảng cách. Không có dòng nào → bằng height*0.08.
  it('T5: buildReplacementAnnotation calculates maskPadTop relative to neighbor above or defaults to height*0.08', () => {
    const region: TextRegion = {
      id: 'reg-target',
      page: 1,
      text: 'Test Line',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.05,
      fontSize: 12,
      fontFamily: 'Helvetica',
      source: 'native',
    }

    // Case A: Neighbor directly above with small gap
    // neighbor bottom = 0.18 + 0.015 = 0.195; gap = 0.2 - 0.195 = 0.005
    const neighborAbove: TextRegion = {
      id: 'reg-above',
      page: 1,
      text: 'Above Line',
      x: 0.1,
      y: 0.18,
      width: 0.3,
      height: 0.015,
      fontSize: 12,
      fontFamily: 'Helvetica',
      source: 'native',
    }
    const withNeighbor = buildReplacementAnnotation(region, 'Updated Line', [region, neighborAbove], 'rep-1')
    expect(withNeighbor.maskPadTop).toBeDefined()
    expect(withNeighbor.maskPadTop!).toBeLessThanOrEqual(0.005 * 0.25 + 0.000001)

    // Case B: No neighbor above
    const withoutNeighbor = buildReplacementAnnotation(region, 'Updated Line', [region], 'rep-2')
    expect(withoutNeighbor.maskPadTop).toBeCloseTo(region.height * 0.08, 6)
  })

  // Fixture helper for T6 & T7
  let t6PdfBytes: Uint8Array
  let t6EditedBytes: Uint8Array

  // T6: buildEditedPdf: fixture có chữ Customer: Hoc vien Test 01; annotation thay bằng Customer: Test 02.
  // File xuất mở được, số trang không đổi, pdf.js trích ra có Customer: Test 02.
  it('T6: buildEditedPdf exports valid PDF with replacement annotation text extractable', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Customer: Hoc vien Test 01', { x: 50, y: 350, size: 12, font })
    t6PdfBytes = new Uint8Array(await doc.save())

    const replacementAnn: Annotation = {
      id: 'ann-t6',
      page: 1,
      type: 'text',
      text: 'Customer: Test 02',
      x: 50 / 600,
      y: (400 - 350 - 12) / 400,
      width: 200 / 600,
      height: 15 / 400,
      fontSize: 12,
      color: '#000000',
      opacity: 1,
      replaceOriginal: true,
      backgroundColor: '#ffffff',
    }

    t6EditedBytes = await buildEditedPdf(t6PdfBytes, [replacementAnn])
    expect(t6EditedBytes).toBeInstanceOf(Uint8Array)

    const loadedDoc = await pdfjsLib.getDocument({ data: t6EditedBytes.slice() }).promise
    expect(loadedDoc.numPages).toBe(1)

    const text = await extractTextFromPdf(t6EditedBytes)
    expect(text).toContain('Customer: Test 02')
  })

  // T7: cùng file ở T6 → pdf.js vẫn trích ra Customer: Hoc vien Test 01. Ghi comment: "W-9 sẽ đảo test này".
  it('KNOWN ISSUE B1: retains original text in exported PDF when text region is replaced', async () => {
    // W-9 sẽ đảo test này: hiện tại thay chữ chỉ vẽ hình chữ nhật che đè lên nên chữ gốc vẫn còn trong content stream.
    const text = await extractTextFromPdf(t6EditedBytes)
    expect(text).toContain('Customer: Hoc vien Test 01')
  })

  // T8: highlight + ink (3 điểm) + ảnh PNG 1×1 (data URL hằng số trong test) → xuất không lỗi, số trang không đổi.
  it('T8: buildEditedPdf exports highlight, ink, and PNG image without error', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const pdfBytes = new Uint8Array(await doc.save())

    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const annotations: Annotation[] = [
      {
        id: 'ann-hl',
        page: 1,
        type: 'highlight',
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.05,
        color: '#F5C84C',
        opacity: 0.38,
      },
      {
        id: 'ann-ink',
        page: 1,
        type: 'draw',
        x: 0.1,
        y: 0.2,
        width: 0,
        height: 0,
        color: '#E85D3F',
        opacity: 1,
        points: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.25 }, { x: 0.3, y: 0.2 }],
      },
      {
        id: 'ann-img',
        page: 1,
        type: 'image',
        x: 0.4,
        y: 0.4,
        width: 0.2,
        height: 0.2,
        color: '#000000',
        opacity: 1,
        imageDataUrl: png1x1,
      },
    ]

    const out = await buildEditedPdf(pdfBytes, annotations, {
      loadImageBytes: async (dataUrl) => {
        const base64 = dataUrl.split(',')[1]
        const buf = Buffer.from(base64, 'base64')
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      },
    })

    const loaded = await pdfjsLib.getDocument({ data: out.slice() }).promise
    expect(loaded.numPages).toBe(1)
  })

  // ==========================================
  // Task F-11 Tests: K1 - K6
  // ==========================================

  const S = 'Học viên Test 01 – Đường Ưu Đãi, Quận Mẫu ₫'
  const vnLower = 'a à á ả ã ạ ă ằ ắ ẳ ẵ ặ â ầ ấ ẩ ẫ ậ b c d đ e è é ẻ ẽ ẹ ê ề ế ể ễ ệ g h i ì í ỉ ĩ ị k l m n o ò ó ỏ õ ọ ô ồ ố ổ ỗ ộ ơ ờ ớ ở ỡ ợ p q r s t u ù ú ủ ũ ụ ư ừ ứ ử ữ ự v x y ỳ ý ỷ ỹ ỵ'.split(' ')
  const vnUpper = vnLower.map((c) => c.toUpperCase())
  const digitsAndPunc = '0123456789.,;:!?()-/@%&"\'–₫'.split('')
  const VN = Array.from(new Set([...vnLower, ...vnUpper, ...digitsAndPunc]))

  // K1: Test đọc 8 file TTF: SHA256 khớp SOURCES.md; fontkit có glyph cho mọi ký tự trong VN.
  it('K1: all 8 TTF files match SOURCES.md SHA256 and fontkit provides glyphs for all VN characters', () => {
    const sourcesMd = fs.readFileSync(path.join(fontsDir, 'SOURCES.md'), 'utf-8')
    const ttfFiles = [
      'BeVietnamPro-Regular.ttf',
      'BeVietnamPro-Italic.ttf',
      'BeVietnamPro-Bold.ttf',
      'BeVietnamPro-BoldItalic.ttf',
      'Arimo-Regular.ttf',
      'Arimo-Italic.ttf',
      'Arimo-Bold.ttf',
      'Arimo-BoldItalic.ttf',
    ]

    expect(ttfFiles).toHaveLength(8)

    for (const filename of ttfFiles) {
      const filePath = path.join(fontsDir, filename)
      expect(fs.existsSync(filePath), `File exists: ${filename}`).toBe(true)
      const buf = fs.readFileSync(filePath)

      const hash = crypto.createHash('sha256').update(buf).digest('hex').toLowerCase()
      expect(sourcesMd.toLowerCase()).toContain(hash)

      const font = fontkit.create(buf)
      for (const char of VN) {
        const cp = char.codePointAt(0)!
        const hasGlyph = font.hasGlyphForCodePoint(cp)
        expect(hasGlyph, `Font ${filename} missing glyph for '${char}' (U+${cp.toString(16).toUpperCase()})`).toBe(true)
      }
    }
  })

  // K2: buildEditedPdf với 8 annotation (2 family × 4 biến thể), mỗi cái mang chuỗi S → pdf.js trích ra đúng nguyên văn S cho cả 8.
  it('K2: buildEditedPdf with 8 annotations across 2 families and 4 variants extracts exact S for all', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([800, 1000])
    const baseBytes = new Uint8Array(await doc.save())

    const families = ['Be Vietnam Pro', 'Arimo'] as const
    const variants = [
      { bold: false, italic: false },
      { bold: false, italic: true },
      { bold: true, italic: false },
      { bold: true, italic: true },
    ]

    const annotations: Annotation[] = []
    let idx = 0
    for (const family of families) {
      for (const v of variants) {
        annotations.push({
          id: `ann-k2-${idx}`,
          page: 1,
          type: 'text',
          text: S,
          fontFamily: family,
          bold: v.bold,
          italic: v.italic,
          fontSize: 14,
          color: '#0C2340',
          opacity: 1,
          x: 0.05,
          y: 0.05 + idx * 0.1,
          width: 0.9,
          height: 0.08,
        })
        idx++
      }
    }

    const out = await buildEditedPdf(baseBytes, annotations, { loadFontBytes: loadRealFontBytes })
    const extracted = await extractTextFromPdf(out)
    const count = extracted.split(S).length - 1
    expect(count).toBe(8)
  })

  // K3: fontFamily: 'Helvetica' + chuỗi S → xuất bằng Arimo (BaseFont trong PDF chứa Arimo), trích ra đúng S.
  // Tương tự với Times Roman, Courier, Noto Sans.
  it('K3: requested standard/Noto fonts with Vietnamese text S fall back to Arimo with BaseFont containing Arimo', async () => {
    const testFamilies: Array<NonNullable<Annotation['fontFamily']>> = [
      'Helvetica',
      'Times Roman',
      'Courier',
      'Noto Sans',
    ]

    for (const reqFamily of testFamilies) {
      const doc = await PDFDocument.create()
      doc.addPage([600, 400])
      const baseBytes = new Uint8Array(await doc.save())

      const ann: Annotation = {
        id: `ann-k3-${reqFamily}`,
        page: 1,
        type: 'text',
        text: S,
        fontFamily: reqFamily,
        fontSize: 14,
        color: '#000000',
        opacity: 1,
        x: 0.1,
        y: 0.2,
        width: 0.8,
        height: 0.1,
      }

      const out = await buildEditedPdf(baseBytes, [ann], { loadFontBytes: loadRealFontBytes })
      const baseFontNames = await getBaseFontNames(out)
      expect(baseFontNames.some((bf) => bf.includes('Arimo'))).toBe(true)

      const extracted = await extractTextFromPdf(out)
      expect(extracted).toContain(S)
    }
  })

  // K4: fontFamily: 'Helvetica' + Customer: Test 02 (ASCII) → vẫn dùng font chuẩn Helvetica (BaseFont Helvetica).
  it('K4: requested standard font Helvetica with pure ASCII text preserves standard Helvetica font', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const baseBytes = new Uint8Array(await doc.save())

    const asciiText = 'Customer: Test 02'
    const ann: Annotation = {
      id: 'ann-k4',
      page: 1,
      type: 'text',
      text: asciiText,
      fontFamily: 'Helvetica',
      fontSize: 14,
      color: '#000000',
      opacity: 1,
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.1,
    }

    const out = await buildEditedPdf(baseBytes, [ann], { loadFontBytes: loadRealFontBytes })
    const baseFontNames = await getBaseFontNames(out)
    expect(baseFontNames.some((bf) => bf.includes('Helvetica'))).toBe(true)
    expect(baseFontNames.some((bf) => bf.includes('Arimo'))).toBe(false)

    const extracted = await extractTextFromPdf(out)
    expect(extracted).toContain(asciiText)
  })

  // K5: loadFontBytes reject → buildEditedPdf reject, message bắt đầu FONT_LOAD_FAILED:. Không sinh file.
  it('K5: loadFontBytes rejection causes buildEditedPdf to reject loudly with FONT_LOAD_FAILED:', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const baseBytes = new Uint8Array(await doc.save())

    const ann: Annotation = {
      id: 'ann-k5',
      page: 1,
      type: 'text',
      text: S,
      fontFamily: 'Be Vietnam Pro',
      fontSize: 14,
      color: '#000000',
      opacity: 1,
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.1,
    }

    const failingLoadFontBytes = async (): Promise<ArrayBuffer> => {
      throw new Error('Network timeout simulated')
    }

    await expect(
      buildEditedPdf(baseBytes, [ann], { loadFontBytes: failingLoadFontBytes }),
    ).rejects.toThrow(/^FONT_LOAD_FAILED:/)
  })

  // K6: annotation Be Vietnam Pro chứa Test 你好 😀 → reject, message bắt đầu MISSING_GLYPH: và chứa 你.
  it('K6: annotation containing unsupported glyphs rejects with MISSING_GLYPH: and names the missing char', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const baseBytes = new Uint8Array(await doc.save())

    const ann: Annotation = {
      id: 'ann-k6',
      page: 1,
      type: 'text',
      text: 'Test 你好 😀',
      fontFamily: 'Be Vietnam Pro',
      fontSize: 14,
      color: '#000000',
      opacity: 1,
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.1,
    }

    let error: Error | null = null
    try {
      await buildEditedPdf(baseBytes, [ann], { loadFontBytes: loadRealFontBytes })
    } catch (err: unknown) {
      if (err instanceof Error) {
        error = err
      } else {
        error = new Error(String(err))
      }
    }

    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/^MISSING_GLYPH:/)
    expect(error!.message).toContain('你')
  })

  // T10: pageOps: movePage, deletePage, insertPdfPages và các hàm remap annotations.
  it('T10: pageOps executes movePage, deletePage, insertPdfPages and remaps annotations correctly', async () => {
    // Create 3 page PDF with marker texts
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p1 = doc.addPage([400, 400])
    p1.drawText('P1', { x: 50, y: 350, font, size: 20 })
    const p2 = doc.addPage([400, 400])
    p2.drawText('P2', { x: 50, y: 350, font, size: 20 })
    const p3 = doc.addPage([400, 400])
    p3.drawText('P3', { x: 50, y: 350, font, size: 20 })
    const initialBytes = new Uint8Array(await doc.save())

    // 1. movePage(0 -> 1): order P2, P1, P3
    const movedBytes = await movePage(initialBytes, 0, 1)
    const movedDoc = await pdfjsLib.getDocument({ data: movedBytes.slice(), standardFontDataUrl }).promise
    expect(movedDoc.numPages).toBe(3)
    const movedTextP1 = (await (await movedDoc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    const movedTextP2 = (await (await movedDoc.getPage(2)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    const movedTextP3 = (await (await movedDoc.getPage(3)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    expect(movedTextP1).toContain('P2')
    expect(movedTextP2).toContain('P1')
    expect(movedTextP3).toContain('P3')

    // 2. deletePage(1): deletes index 1 (P2 in original doc) -> 2 pages left (P1, P3)
    const deletedBytes = await deletePage(initialBytes, 1)
    const delDoc = await pdfjsLib.getDocument({ data: deletedBytes.slice(), standardFontDataUrl }).promise
    expect(delDoc.numPages).toBe(2)
    const delTextP1 = (await (await delDoc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    const delTextP2 = (await (await delDoc.getPage(2)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    expect(delTextP1).toContain('P1')
    expect(delTextP2).toContain('P3')

    // 3. insertPdfPages after page 1
    const srcDoc = await PDFDocument.create()
    const srcFont = await srcDoc.embedFont(StandardFonts.Helvetica)
    const sp = srcDoc.addPage([400, 400])
    sp.drawText('INSERTED', { x: 50, y: 350, font: srcFont, size: 20 })
    const srcBytes = new Uint8Array(await srcDoc.save())

    const { bytes: insertedBytes, insertedCount } = await insertPdfPages(initialBytes, srcBytes, 1)
    expect(insertedCount).toBe(1)
    const insDoc = await pdfjsLib.getDocument({ data: insertedBytes.slice(), standardFontDataUrl }).promise
    expect(insDoc.numPages).toBe(4)
    const insTextP1 = (await (await insDoc.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    const insTextP2 = (await (await insDoc.getPage(2)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    const insTextP3 = (await (await insDoc.getPage(3)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('')
    expect(insTextP1).toContain('P1')
    expect(insTextP2).toContain('INSERTED')
    expect(insTextP3).toContain('P2')

    // 4. Remap functions
    const testAnnotations: Annotation[] = [
      { id: 'a1', page: 1, type: 'text', x: 0, y: 0, width: 0.1, height: 0.1, color: '#000', opacity: 1 },
      { id: 'a2', page: 2, type: 'text', x: 0, y: 0, width: 0.1, height: 0.1, color: '#000', opacity: 1 },
      { id: 'a3', page: 3, type: 'text', x: 0, y: 0, width: 0.1, height: 0.1, color: '#000', opacity: 1 },
    ]

    const remappedMove = remapAnnotationsOnMove(testAnnotations, 1, 2)
    expect(remappedMove.find((a) => a.id === 'a1')?.page).toBe(2)
    expect(remappedMove.find((a) => a.id === 'a2')?.page).toBe(1)
    expect(remappedMove.find((a) => a.id === 'a3')?.page).toBe(3)

    const remappedDelete = remapAnnotationsOnDelete(testAnnotations, 2)
    expect(remappedDelete.find((a) => a.id === 'a1')?.page).toBe(1)
    expect(remappedDelete.find((a) => a.id === 'a2')).toBeUndefined()
    expect(remappedDelete.find((a) => a.id === 'a3')?.page).toBe(2)

    const remappedInsert = remapAnnotationsOnInsert(testAnnotations, 1, 2)
    expect(remappedInsert.find((a) => a.id === 'a1')?.page).toBe(1)
    expect(remappedInsert.find((a) => a.id === 'a2')?.page).toBe(4)
    expect(remappedInsert.find((a) => a.id === 'a3')?.page).toBe(5)
  })
})
