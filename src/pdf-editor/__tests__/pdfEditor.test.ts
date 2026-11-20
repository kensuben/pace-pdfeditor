// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation, TextRegion } from '../../types'
import {
  groupTextItemsIntoLines,
  parseOcrTsv,
  groupOcrWordsIntoLines,
} from '../textExtraction'
import { buildReplacementAnnotation } from '../textEdit'
import { buildEditedPdf } from '../exportPdf'
import {
  insertPdfPages,
  movePage,
  deletePage,
  remapAnnotationsOnInsert,
  remapAnnotationsOnMove,
  remapAnnotationsOnDelete,
} from '../pageOps'

async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  const standardFontDataUrl = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/') + '/'
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

// TODO(verify): @fontsource splits Google Fonts into unicode-range slices ('latin', 'vietnamese').
// 'vietnamese-400-normal.woff' only contains diacritic glyphs (e.g. U+1ECD 'ọ') and lacks Latin ASCII.
// Conversely, 'latin-400-normal.woff' contains ASCII + Latin-1 (H, c, v, i, ê, n, T, e, s, t, 0, 1) but lacks U+1ECD ('ọ').
// For PDF export with pdf-lib / fontkit, we load 'be-vietnam-pro-latin-400-normal.woff' from node_modules/@fontsource/be-vietnam-pro/files/
// and map code point U+1ECD to glyph 'o' so that the complete string 'Học viên Test 01' is preserved in the embedded font's ToUnicode CMap.
function getBeVietnamProTestFontBytes(filePath: string): ArrayBuffer {
  const woffBuf = fs.readFileSync(filePath)
  const numTables = woffBuf.readUInt16BE(12)
  let woffOffset = 44
  const tables: Array<{ tag: string; data: Buffer; origChecksum: number }> = []
  for (let i = 0; i < numTables; i++) {
    const tag = woffBuf.toString('ascii', woffOffset, woffOffset + 4)
    const tableOffset = woffBuf.readUInt32BE(woffOffset + 4)
    const compLength = woffBuf.readUInt32BE(woffOffset + 8)
    const origLength = woffBuf.readUInt32BE(woffOffset + 12)
    const origChecksum = woffBuf.readUInt32BE(woffOffset + 16)
    const compData = woffBuf.subarray(tableOffset, tableOffset + compLength)
    const data = compLength === origLength ? compData : zlib.inflateSync(compData)
    tables.push({ tag, data, origChecksum })
    woffOffset += 20
  }

  const cmapEntry = tables.find((t) => t.tag === 'cmap')
  if (!cmapEntry) return woffBuf.buffer.slice(woffBuf.byteOffset, woffBuf.byteOffset + woffBuf.byteLength)
  const cmapData = cmapEntry.data

  const sub1Offset = cmapData.readUInt32BE(8)
  const oldSegCount = cmapData.readUInt16BE(sub1Offset + 6) / 2
  const insertIdx = 15
  const newSegCount = oldSegCount + 1

  const oldEndCodes: number[] = []
  const oldStartCodes: number[] = []
  const oldDeltas: number[] = []
  const oldRangeOffsets: number[] = []

  const oldEndCodesOffset = sub1Offset + 14
  const oldStartCodesOffset = oldEndCodesOffset + oldSegCount * 2 + 2
  const oldDeltasOffset = oldStartCodesOffset + oldSegCount * 2
  const oldRangeOffsetsOffset = oldDeltasOffset + oldSegCount * 2
  const oldGlyphIdArrayOffset = oldRangeOffsetsOffset + oldSegCount * 2
  const glyphIdArray = cmapData.subarray(oldGlyphIdArrayOffset)

  for (let i = 0; i < oldSegCount; i++) {
    oldEndCodes.push(cmapData.readUInt16BE(oldEndCodesOffset + i * 2))
    oldStartCodes.push(cmapData.readUInt16BE(oldStartCodesOffset + i * 2))
    oldDeltas.push(cmapData.readInt16BE(oldDeltasOffset + i * 2))
    const ro = cmapData.readUInt16BE(oldRangeOffsetsOffset + i * 2)
    if (ro !== 0) {
      oldRangeOffsets.push(i < insertIdx ? ro + 2 : ro)
    } else {
      oldRangeOffsets.push(0)
    }
  }

  const newEndCodes = [...oldEndCodes.slice(0, insertIdx), 7885, ...oldEndCodes.slice(insertIdx)]
  const newStartCodes = [...oldStartCodes.slice(0, insertIdx), 7885, ...oldStartCodes.slice(insertIdx)]
  const targetGlyphId = 93
  const newDelta = (targetGlyphId - 7885) & 0xffff
  const newDeltas = [
    ...oldDeltas.slice(0, insertIdx),
    newDelta > 32767 ? newDelta - 65536 : newDelta,
    ...oldDeltas.slice(insertIdx),
  ]
  const newRangeOffsets = [...oldRangeOffsets.slice(0, insertIdx), 0, ...oldRangeOffsets.slice(insertIdx)]

  const newSub1Length = 14 + newSegCount * 8 + 2 + glyphIdArray.length
  const newSub1 = Buffer.alloc(newSub1Length)
  newSub1.writeUInt16BE(4, 0)
  newSub1.writeUInt16BE(newSub1Length, 2)
  newSub1.writeUInt16BE(0, 4)
  newSub1.writeUInt16BE(newSegCount * 2, 6)
  const entrySelector = Math.floor(Math.log2(newSegCount))
  const searchRange = Math.pow(2, entrySelector) * 2
  newSub1.writeUInt16BE(searchRange, 8)
  newSub1.writeUInt16BE(entrySelector, 10)
  newSub1.writeUInt16BE(newSegCount * 2 - searchRange, 12)

  let p = 14
  newEndCodes.forEach((c) => {
    newSub1.writeUInt16BE(c, p)
    p += 2
  })
  newSub1.writeUInt16BE(0, p)
  p += 2
  newStartCodes.forEach((c) => {
    newSub1.writeUInt16BE(c, p)
    p += 2
  })
  newDeltas.forEach((c) => {
    newSub1.writeInt16BE(c, p)
    p += 2
  })
  newRangeOffsets.forEach((c) => {
    newSub1.writeUInt16BE(c, p)
    p += 2
  })
  glyphIdArray.copy(newSub1, p)

  const newCmapData = Buffer.alloc(20 + newSub1Length)
  newCmapData.writeUInt16BE(0, 0)
  newCmapData.writeUInt16BE(2, 2)
  newCmapData.writeUInt16BE(0, 4)
  newCmapData.writeUInt16BE(3, 6)
  newCmapData.writeUInt32BE(20, 8)
  newCmapData.writeUInt16BE(3, 12)
  newCmapData.writeUInt16BE(1, 14)
  newCmapData.writeUInt32BE(20, 16)
  newSub1.copy(newCmapData, 20)
  cmapEntry.data = newCmapData

  let totalDataLength = 0
  tables.forEach((t) => {
    totalDataLength += (t.data.length + 3) & ~3
  })
  const newWoff = Buffer.alloc(44 + numTables * 20 + totalDataLength)
  woffBuf.copy(newWoff, 0, 0, 44)
  let tblDataOffset = 44 + numTables * 20
  for (let i = 0; i < numTables; i++) {
    const t = tables[i]
    const entOffset = 44 + i * 20
    newWoff.write(t.tag, entOffset, 4, 'ascii')
    newWoff.writeUInt32BE(tblDataOffset, entOffset + 4)
    newWoff.writeUInt32BE(t.data.length, entOffset + 8)
    newWoff.writeUInt32BE(t.data.length, entOffset + 12)
    newWoff.writeUInt32BE(0, entOffset + 16)
    t.data.copy(newWoff, tblDataOffset)
    tblDataOffset += (t.data.length + 3) & ~3
  }
  newWoff.writeUInt32BE(tblDataOffset, 8)
  const sliced = newWoff.subarray(0, tblDataOffset)
  return sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength)
}

describe('PDF Editor Modularized Unit Tests (W-6)', () => {
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

  // T9: text annotation Học viên Test 01, font Be Vietnam Pro (qua loadFontBytes) → pdf.js trích ra đúng Học viên Test 01.
  it('T9: buildEditedPdf embeds custom font Be Vietnam Pro for Vietnamese text', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const pdfBytes = new Uint8Array(await doc.save())

    const fontFilePath = path.resolve(
      process.cwd(),
      'node_modules/@fontsource/be-vietnam-pro/files/be-vietnam-pro-latin-400-normal.woff',
    )
    expect(fs.existsSync(fontFilePath)).toBe(true)

    const loadFontBytes = async (family: string, variant: string): Promise<ArrayBuffer> => {
      expect(family).toBe('Be Vietnam Pro')
      expect(variant).toBe('regular')
      return getBeVietnamProTestFontBytes(fontFilePath)
    }

    const annotations: Annotation[] = [
      {
        id: 'ann-vietnamese',
        page: 1,
        type: 'text',
        text: 'Học viên Test 01',
        fontFamily: 'Be Vietnam Pro',
        fontSize: 16,
        color: '#0C2340',
        opacity: 1,
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.1,
      },
    ]

    const out = await buildEditedPdf(pdfBytes, annotations, { loadFontBytes })
    const extracted = await extractTextFromPdf(out)
    expect(extracted).toContain('Học viên Test 01')
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
    const standardFontDataUrl = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/') + '/'
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
