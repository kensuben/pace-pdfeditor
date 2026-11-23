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
  groupTextItemsIntoLines,
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

describe('F-18b: Mirrored left margin as right limit for single-line replacements', () => {
  // =========================================================================
  // K1: Widest line on page extends to mirrored right margin
  // =========================================================================
  it('K1: widest line on page extends to mirrored right margin, not clamped to original width', () => {
    const x = 70 / 595
    const r1: TextRegion = {
      id: 'r1',
      page: 1,
      text: 'Kinh gui: Hoc vien Test 01',
      x,
      y: 0.1,
      width: 150 / 595,
      height: 16 / 842,
      fontSize: 13,
      source: 'native',
    }

    // Widest line among the 3
    const r2: TextRegion = {
      id: 'r2',
      page: 1,
      text: 'Dia chi: So 1 Duong Test, Ha Noi',
      x,
      y: 0.15,
      width: 200 / 595,
      height: 16 / 842,
      fontSize: 13,
      source: 'native',
    }

    const r3: TextRegion = {
      id: 'r3',
      page: 1,
      text: 'Email: test@example.com',
      x,
      y: 0.2,
      width: 120 / 595,
      height: 16 / 842,
      fontSize: 13,
      source: 'native',
    }

    const neighbors = [r1, r2, r3]
    const ann = buildReplacementAnnotation(r2, 'Dia chi: So 1 Duong Test, Ha Noi', neighbors, 'ann-k1', 595)

    const expectedMaxWidth = (1 - x) - x
    expect(ann.maxWidth).toBeDefined()
    expect(ann.maxWidth!).toBeCloseTo(expectedMaxWidth, 2)
    expect(ann.maxWidth!).toBeGreaterThan(r2.width + 0.1)
  })

  // =========================================================================
  // K2: Same-row right neighbor still takes priority (identical to F-18)
  // =========================================================================
  it('K2: same-row right neighbor at x=0.5 limits maxWidth to 0.5 - gap - region.x', () => {
    const x = 70 / 595
    const r2: TextRegion = {
      id: 'r2',
      page: 1,
      text: 'Dia chi: So 1 Duong Test, Ha Noi',
      x,
      y: 0.15,
      width: 200 / 595,
      height: 16 / 842,
      fontSize: 13,
      source: 'native',
    }

    const rightNeighbor: TextRegion = {
      id: 'r-right',
      page: 1,
      text: 'Cot ben phai',
      x: 0.5,
      y: 0.15,
      width: 100 / 595,
      height: 16 / 842,
      fontSize: 13,
      source: 'native',
    }

    const neighbors = [r2, rightNeighbor]
    const ann = buildReplacementAnnotation(r2, 'Dia chi updated', neighbors, 'ann-k2', 595)

    const gap = (0.5 * 13) / 595
    const expectedMaxWidth = 0.5 - gap - x
    expect(ann.maxWidth).toBeDefined()
    expect(ann.maxWidth!).toBeCloseTo(expectedMaxWidth, 2)
  })

  // =========================================================================
  // K3: Page number / margin text at x=0.01 is clamped to 0.03 minimum margin
  // =========================================================================
  it('K3: text near left edge at x=0.01 clamps minContentLeft to 0.03 producing maxWidth ≈ 0.97 - region.x', () => {
    const region: TextRegion = {
      id: 'r-main',
      page: 1,
      text: 'Main content line',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.02,
      fontSize: 12,
      source: 'native',
    }

    const pageNumber: TextRegion = {
      id: 'r-pg',
      page: 1,
      text: '1',
      x: 0.01,
      y: 0.95,
      width: 0.02,
      height: 0.02,
      fontSize: 10,
      source: 'native',
    }

    const ann = buildReplacementAnnotation(region, 'Updated content', [region, pageNumber], 'ann-k3', 595)
    // mirroredRight = 1 - Math.max(0.01, 0.03) = 0.97
    // maxWidth = 0.97 - region.x = 0.87
    expect(ann.maxWidth).toBeDefined()
    expect(ann.maxWidth!).toBeCloseTo(0.97 - region.x, 2)
  })

  // =========================================================================
  // K4: Export with real pdf.js - widest line replacement exports in 1 line
  // =========================================================================
  it('K4: replacing widest line in 3-line document exports in 1 line with pdf.js verification', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.TimesRoman)

    page.drawText('Kinh gui: Hoc vien Test 01', { x: 70, y: 750, size: 13, font })
    page.drawText('Dia chi: So 1 Duong Test, Ha Noi', { x: 70, y: 720, size: 13, font })
    page.drawText('Email: test@example.com', { x: 70, y: 690, size: 13, font })

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

    const targetRegion = rawLines.find((r) => r.text.includes('Dia chi: So 1 Duong Test, Ha Noi'))!
    expect(targetRegion).toBeDefined()

    // Replace with Vietnamese text: "Địa chỉ: Số 1 Đường Test, Hà Nội"
    const replacementText = 'Địa chỉ: Số 1 Đường Test, Hà Nội'
    const ann = buildReplacementAnnotation(targetRegion, replacementText, rawLines, 'ann-addr', viewport.width)

    expect(ann.maxWidth).toBeGreaterThan(targetRegion.width + 0.1)

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [ann], {
      loadFontBytes: loadRealFontBytes,
    })

    expect(report.overflowPages).toHaveLength(0)

    const outDoc = await pdfjsLib.getDocument({ data: outBytes.slice(), standardFontDataUrl }).promise
    const outPage = await outDoc.getPage(1)
    const outContent = await outPage.getTextContent()

    // Must be exactly 1 item for the replacement string on 1 single line (not split into 2)
    const item = outContent.items.find((it) => 'str' in it && it.str.includes('Địa chỉ: Số 1 Đường Test, Hà Nội')) as
      | { str: string; transform: number[] }
      | undefined
    expect(item).toBeDefined()
    expect(item!.str).toBe('Địa chỉ: Số 1 Đường Test, Hà Nội')
  })
})
