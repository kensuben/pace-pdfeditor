// @vitest-environment node
if (typeof DOMMatrix === 'undefined') {
  // @ts-expect-error polyfill for node
  globalThis.DOMMatrix = class DOMMatrix {}
}

import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  buildEditedPdfWithReport,
  buildEditedPdf,
  findRemainingOriginalText,
  formatRemainingTextWarning,
  buildReplacementAnnotation,
} from '../index'
import type { Annotation, TextRegion } from '../../types'
import { readPageContent } from '../engine/pageContent'
import { tokenizeContent } from '../engine/contentTokenizer'

async function extractItems(bytes: Uint8Array, pageNum = 1) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const page = await doc.getPage(pageNum)
  const content = await page.getTextContent()
  const items: Array<{ str: string; x: number; y: number }> = []
  for (const it of content.items) {
    if ('str' in it && 'transform' in it && Array.isArray(it.transform)) {
      items.push({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
      })
    }
  }
  return items
}

async function extractFullText(bytes: Uint8Array, pageNum = 1): Promise<string> {
  const items = await extractItems(bytes, pageNum)
  return items.map((i) => i.str).join(' ')
}

describe('W-9a: Export Real Text Removal & Remaining Text Warnings Suite', () => {
  // Helper to build standard 3-line document
  async function create3LinePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Line A', { x: 50, y: 350, size: 14, font })
    page.drawText('Customer: Hoc vien Test 01', { x: 50, y: 300, size: 14, font })
    page.drawText('Line C', { x: 50, y: 250, size: 14, font })
    return new Uint8Array(await doc.save())
  }

  it('K1: cleanly removes original text via engine, leaves other lines intact, reports cleanedPages', async () => {
    const baseBytes = await create3LinePdf()
    const baseItems = await extractItems(baseBytes, 1)

    const lineAOrig = baseItems.find((i) => i.str.includes('Line A'))!
    const lineCOrig = baseItems.find((i) => i.str.includes('Line C'))!

    const region: TextRegion = {
      id: 'reg-2',
      page: 1,
      text: 'Customer: Hoc vien Test 01',
      x: 50 / 600,
      y: (400 - 300 - 14) / 400,
      width: 200 / 600,
      height: 18 / 400,
      fontSize: 14,
      fontFamily: 'Helvetica',
      source: 'native',
    }

    const ann = buildReplacementAnnotation(region, 'Customer: Test 02', [])

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [ann])

    const outText = await extractFullText(outBytes, 1)
    expect(outText).not.toContain('Hoc vien Test 01')
    expect(outText).toContain('Customer: Test 02')

    const outItems = await extractItems(outBytes, 1)
    const lineAAfter = outItems.find((i) => i.str.includes('Line A'))!
    const lineCAfter = outItems.find((i) => i.str.includes('Line C'))!

    expect(Math.abs(lineAAfter.x - lineAOrig.x)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(lineAAfter.y - lineAOrig.y)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(lineCAfter.x - lineCOrig.x)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(lineCAfter.y - lineCOrig.y)).toBeLessThanOrEqual(0.01)

    expect(report.editedPages).toEqual([1])
    expect(report.cleanedPages).toEqual([1])
    expect(report.maskedPages).toEqual([])
    expect(report.warnings).toEqual([])
  })

  it('K2: line deletion (text = "") removes original text, does not draw new text or mask', async () => {
    const baseBytes = await create3LinePdf()

    const region: TextRegion = {
      id: 'reg-2',
      page: 1,
      text: 'Customer: Hoc vien Test 01',
      x: 50 / 600,
      y: (400 - 300 - 14) / 400,
      width: 200 / 600,
      height: 18 / 400,
      fontSize: 14,
      fontFamily: 'Helvetica',
      source: 'native',
    }

    const ann = buildReplacementAnnotation(region, '', [])

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [ann])

    const outText = await extractFullText(outBytes, 1)
    expect(outText).not.toContain('Hoc vien Test 01')
    expect(outText).not.toContain('Customer: Test 02')
    expect(outText).toContain('Line A')
    expect(outText).toContain('Line C')

    expect(report.cleanedPages).toEqual([1])
    expect(report.maskedPages).toEqual([])
    expect(report.warnings).toEqual([])
  })

  it('K3: handles rotated page (/Rotate 90) and offset CropBox correctly', async () => {
    // 1. Page with /Rotate 90
    const docRot = await PDFDocument.create()
    const pageRot = docRot.addPage([600, 400])
    pageRot.setRotation(degrees(90))
    const fontRot = await docRot.embedFont(StandardFonts.Helvetica)
    pageRot.drawText('Line A', { x: 50, y: 350, size: 14, font: fontRot })
    pageRot.drawText('Customer: Hoc vien Test 01', { x: 50, y: 300, size: 14, font: fontRot })
    pageRot.drawText('Line C', { x: 50, y: 250, size: 14, font: fontRot })
    const rotBytes = new Uint8Array(await docRot.save())

    // In view space of 90 deg rotated page: width = 400, height = 600
    // viewToPdf(90, u, v): x = x0 + v * 600, y = y0 + u * 400
    // We want x = 50, y = 300: v = 50 / 600, u = 300 / 400 = 0.75
    const annRot: Annotation = {
      id: 'ann-rot',
      page: 1,
      type: 'text',
      color: '#000000',
      x: 0.75 - 0.05,
      y: 50 / 600 - 0.02,
      width: 0.15,
      height: 0.35,
      opacity: 1,
      replaceOriginal: true,
      text: 'Customer: Rotated 02',
      originalText: 'Customer: Hoc vien Test 01',
      originalSource: 'native',
    }

    const { bytes: outRotBytes } = await buildEditedPdfWithReport(rotBytes, [annRot])
    const rotText = await extractFullText(outRotBytes, 1)
    expect(rotText).not.toContain('Hoc vien Test 01')
    expect(rotText).toContain('Line A')
    expect(rotText).toContain('Line C')

    // 2. Page with offset MediaBox / CropBox [100, 100, 700, 500] (size 600x400 offset by 100, 100)
    const docOffset = await PDFDocument.create()
    const pageOffset = docOffset.addPage([800, 600])
    pageOffset.setMediaBox(100, 100, 600, 400)
    pageOffset.setCropBox(100, 100, 600, 400)
    const fontOffset = await docOffset.embedFont(StandardFonts.Helvetica)
    pageOffset.drawText('Line A', { x: 150, y: 450, size: 14, font: fontOffset })
    pageOffset.drawText('Customer: Hoc vien Test 01', { x: 150, y: 400, size: 14, font: fontOffset })
    pageOffset.drawText('Line C', { x: 150, y: 350, size: 14, font: fontOffset })
    const offsetBytes = new Uint8Array(await docOffset.save())

    const annOffset: Annotation = {
      id: 'ann-offset',
      page: 1,
      type: 'text',
      color: '#000000',
      x: 50 / 600,
      y: (400 - 300 - 14) / 400,
      width: 200 / 600,
      height: 18 / 400,
      opacity: 1,
      replaceOriginal: true,
      text: 'Customer: Offset 02',
      originalText: 'Customer: Hoc vien Test 01',
      originalSource: 'native',
    }

    const { bytes: outOffsetBytes } = await buildEditedPdfWithReport(offsetBytes, [annOffset])
    const offsetText = await extractFullText(outOffsetBytes, 1)
    expect(offsetText).not.toContain('Hoc vien Test 01')
    expect(offsetText).toContain('Line A')
    expect(offsetText).toContain('Line C')
  })

  it('K4: kept-intersecting when text intersects region but center is outside generates warning and draws mask', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    // Draw single long text operation
    page.drawText('Very Long Unbroken Single String Text Instruction 12345', {
      x: 50,
      y: 300,
      size: 14,
      font,
    })
    const baseBytes = new Uint8Array(await doc.save())

    // Replacement region covers only first ~30% of the long string
    const ann: Annotation = {
      id: 'ann-partial',
      page: 1,
      type: 'text',
      color: '#000000',
      x: 50 / 600,
      y: (400 - 300 - 14) / 400,
      width: 80 / 600,
      height: 18 / 400,
      opacity: 1,
      replaceOriginal: true,
      text: 'Replaced Portion',
      originalText: 'Very Long',
      originalSource: 'native',
    }

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [ann])

    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        page: 1,
        reason: 'kept-intersecting',
      })
    )
    expect(report.maskedPages).toContain(1)
    expect(report.cleanedPages).not.toContain(1)

    // Verify mask rectangle was drawn in content stream
    const loaded = await PDFDocument.load(outBytes)
    const content = readPageContent(loaded, 0)
    const ops = tokenizeContent(content)
    const hasDrawRect = ops.some((o) => o.operator === 're' || o.operator === 'f')
    expect(hasDrawRect).toBe(true)
  })

  it('K5: OCR annotation adds ocr-image warning, masks page, and does not invoke engine for OCR-only page', async () => {
    const baseBytes = await create3LinePdf()

    const annOcr: Annotation = {
      id: 'ann-ocr',
      page: 1,
      type: 'text',
      color: '#000000',
      x: 50 / 600,
      y: (400 - 300 - 14) / 400,
      width: 200 / 600,
      height: 18 / 400,
      opacity: 1,
      replaceOriginal: true,
      text: 'Customer: OCR Replaced',
      originalText: 'Customer: Hoc vien Test 01',
      originalSource: 'ocr',
    }

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [annOcr])

    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        page: 1,
        reason: 'ocr-image',
      })
    )
    expect(report.maskedPages).toContain(1)
    expect(report.cleanedPages).not.toContain(1)

    // Because it was OCR, the original native stream on page 1 was NOT modified by removeTextInRegions
    // (though annotations are drawn on top)
    const loaded = await PDFDocument.load(outBytes)
    const content = readPageContent(loaded, 0)
    const ops = tokenizeContent(content)
    // In native stream, the original Tj still exists because engine was skipped
    const tjOps = ops.filter((o) => o.operator === 'Tj')
    expect(tjOps.length).toBeGreaterThanOrEqual(3) // Line A, Customer..., Line C
  })

  it('K6: untouched pages preserve exact byte-for-byte content stream', async () => {
    const doc = await PDFDocument.create()
    const p1 = doc.addPage([600, 400])
    const p2 = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    p1.drawText('Page 1 Text to Replace', { x: 50, y: 300, size: 14, font })
    p2.drawText('Page 2 Untouched Secret Content', { x: 50, y: 300, size: 14, font })
    const baseBytes = new Uint8Array(await doc.save())

    const origDoc = await PDFDocument.load(baseBytes)
    const origP2Bytes = readPageContent(origDoc, 1)

    const ann: Annotation = {
      id: 'ann-p1',
      page: 1,
      type: 'text',
      color: '#000000',
      x: 50 / 600,
      y: (400 - 300 - 14) / 400,
      width: 200 / 600,
      height: 18 / 400,
      opacity: 1,
      replaceOriginal: true,
      text: 'Page 1 Replaced',
      originalText: 'Page 1 Text to Replace',
      originalSource: 'native',
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [ann])
    const outDoc = await PDFDocument.load(outBytes)
    const outP2Bytes = readPageContent(outDoc, 1)

    expect(Buffer.from(outP2Bytes)).toEqual(Buffer.from(origP2Bytes))
  })

  it('K7: findRemainingOriginalText detects leftover text, passes cleaned, and skips superset text', async () => {
    const baseBytes = await create3LinePdf()

    const check = {
      page: 1,
      rect: {
        x: 50 / 600,
        y: (400 - 300 - 14) / 400,
        width: 200 / 600,
        height: 18 / 400,
      },
      originalText: 'Customer: Hoc vien Test 01',
      newText: 'Customer: Test 02',
    }

    // 1. With original unmodified bytes: detects leftover original text
    const badPages = await findRemainingOriginalText(baseBytes, [check])
    expect(badPages).toEqual([1])

    // 2. With cleaned bytes (from K1 export): cleanly returns []
    const ann = {
      id: 'ann-clean',
      page: 1,
      type: 'text' as const,
      color: '#000000',
      x: check.rect.x,
      y: check.rect.y,
      width: check.rect.width,
      height: check.rect.height,
      opacity: 1,
      replaceOriginal: true,
      text: 'Customer: Test 02',
      originalText: check.originalText,
      originalSource: 'native' as const,
    }
    const { bytes: cleanedBytes } = await buildEditedPdfWithReport(baseBytes, [ann])
    const cleanedBadPages = await findRemainingOriginalText(cleanedBytes, [check])
    expect(cleanedBadPages).toEqual([])

    // 3. When newText contains originalText (e.g. user expanded or kept original words): skips check -> []
    const supersetCheck = {
      ...check,
      newText: 'Customer: Hoc vien Test 01 (da cap nhat)',
    }
    const supersetBadPages = await findRemainingOriginalText(baseBytes, [supersetCheck])
    expect(supersetBadPages).toEqual([])
  })

  it('K8: formatRemainingTextWarning formats message with pages and reasons without leaking text', () => {
    const warnings = [
      { page: 2, reason: 'kept-intersecting' as const, regionCount: 1 },
      { page: 5, reason: 'ocr-image' as const, regionCount: 2 },
    ]

    const msg = formatRemainingTextWarning(warnings)

    expect(msg).toContain('Trang 2')
    expect(msg).toContain('Trang 5')
    expect(msg).toContain('chữ cũ nằm chung lệnh vẽ với chữ cần giữ nên chỉ được che bằng nền')
    expect(msg).toContain('chữ nằm trong ảnh scan nên chỉ được che, chưa xoá khỏi ảnh')
    expect(msg).toContain(
      'Lưu ý: Người nhận vẫn có thể copy/tìm thấy chữ cũ; không dùng file này để xoá thông tin nhạy cảm.'
    )

    // Must NOT contain specific text strings
    expect(msg).not.toContain('Hoc vien Test 01')
    expect(msg).not.toContain('Customer')
    expect(msg).not.toContain('Test 02')
  })

  it('K9: legacy annotations without original* fields export safely using annotation bounds', async () => {
    const baseBytes = await create3LinePdf()

    // Legacy annotation from before W-9a (no originalText, originalSource, originalRect)
    const legacyAnn: Annotation = {
      id: 'ann-legacy',
      page: 1,
      type: 'text',
      x: 50 / 600,
      y: (400 - 300 - 14) / 400,
      width: 200 / 600,
      height: 18 / 400,
      fontSize: 14,
      color: '#000000',
      opacity: 1,
      replaceOriginal: true,
      text: 'Customer: Legacy Replaced',
      backgroundColor: '#ffffff',
    }

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [legacyAnn])

    const text = await extractFullText(outBytes, 1)
    expect(text).not.toContain('Hoc vien Test 01')
    expect(text).toContain('Customer: Legacy Replaced')
    expect(report.cleanedPages).toEqual([1])
    expect(report.maskedPages).toEqual([])

    // buildEditedPdf wrapper also functions identically
    const wrappedBytes = await buildEditedPdf(baseBytes, [legacyAnn])
    expect(wrappedBytes).toBeInstanceOf(Uint8Array)
  })
})
