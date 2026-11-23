// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  EXPORT_FONT_FILES,
  resolveExportFontFamily,
  styleFromBaseFont,
  buildEditedPdf,
  buildEditedPdfWithReport,
  buildReplacementAnnotation,
  groupTextItemsIntoLines,
} from '../index'
import type { Annotation } from '../../types'

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
      .map((item: unknown) => ('str' in (item as { str: string }) ? (item as { str: string }).str : ''))
      .join(' ')
    fullText += pageText + '\n'
  }
  return fullText
}

describe('F-17: Tinos Vietnamese Serif Export Suite', () => {
  // =========================================================================
  // K1: SHA256 verification of font files
  // =========================================================================
  it('K1: all 5 Tinos files match expected SHA256 hashes', () => {
    const expectedHashes: Record<string, string> = {
      'Tinos-Regular.ttf': '60A0E8EF0C04DD5DD69FFE91025FA2AE5836CBD35600A82BA031977557E2CB61',
      'Tinos-Italic.ttf': '5942266ED398B155D7DC23E36833E7EC6BE988F2439BDBEB8EF1BEDE808EAA91',
      'Tinos-Bold.ttf': '393269DBAB8899F938DB19783ECA5EAC92EB431F7AE0AB45B8349CA895F1A06B',
      'Tinos-BoldItalic.ttf': 'A5DE79F0FE863EA0954757ACB3D47B3CCD0A930CE3DD5B97230CD3866790A06E',
      'OFL-Tinos.txt': 'CB3382D4643E8B02C12E322C220A3C76A5020D667E4FD4E7C75E744CCA6CAA6B',
    }

    for (const [filename, expectedHash] of Object.entries(expectedHashes)) {
      const filePath = path.join(fontsDir, filename)
      expect(fs.existsSync(filePath), `File exists: ${filename}`).toBe(true)
      const buf = fs.readFileSync(filePath)
      const actualHash = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase()
      expect(actualHash).toBe(expectedHash)
    }
  })

  // =========================================================================
  // K2: resolveExportFontFamily
  // =========================================================================
  it('K2: resolveExportFontFamily maps Times Roman with Vietnamese to Tinos, keeps ASCII Times Roman, and leaves others intact', () => {
    expect(resolveExportFontFamily('Times Roman', 'Học viên Test 01')).toBe('Tinos')
    expect(resolveExportFontFamily('Times Roman', 'Hoc vien Test 01')).toBe('Times Roman')
    expect(resolveExportFontFamily('Tinos', 'abc')).toBe('Tinos')
    expect(resolveExportFontFamily('Helvetica', 'Học viên')).toBe('Arimo')
    expect(resolveExportFontFamily('Courier', 'Học viên')).toBe('Arimo')
    expect(resolveExportFontFamily('Be Vietnam Pro', 'Học viên')).toBe('Be Vietnam Pro')
  })

  // =========================================================================
  // K3: styleFromBaseFont
  // =========================================================================
  it('K3: styleFromBaseFont maps Tinos to Times Roman and handles standard Times New Roman', () => {
    expect(styleFromBaseFont('ABCDEF+Tinos-BoldItalic')).toEqual({
      family: 'Times Roman',
      bold: true,
      italic: true,
    })
    expect(styleFromBaseFont('TimesNewRomanPSMT')).toEqual({
      family: 'Times Roman',
      bold: false,
      italic: false,
    })
  })

  // =========================================================================
  // K4: Export with 4 bold/italic variants using Times Roman + Vietnamese text
  // =========================================================================
  it('K4: exporting Times Roman with Vietnamese text embeds Tinos (all 4 variants), does not contain Arimo, extracts exact text', async () => {
    const testText = 'Hợp đồng số 01/2026 – Học viên Test 01, Đường Test, Hà Nội'
    const variants = [
      { bold: false, italic: false, expectedSubstring: 'Tinos-Regular' },
      { bold: true, italic: false, expectedSubstring: 'Tinos-Bold' },
      { bold: false, italic: true, expectedSubstring: 'Tinos-Italic' },
      { bold: true, italic: true, expectedSubstring: 'Tinos-BoldItalic' },
    ]

    for (const v of variants) {
      const doc = await PDFDocument.create()
      doc.addPage([600, 400])
      const baseBytes = new Uint8Array(await doc.save())

      const ann: Annotation = {
        id: `ann-k4-${v.bold ? 'b' : ''}${v.italic ? 'i' : ''}`,
        page: 1,
        type: 'text',
        text: testText,
        fontFamily: 'Times Roman',
        bold: v.bold,
        italic: v.italic,
        fontSize: 14,
        color: '#000000',
        opacity: 1,
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.1,
      }

      const outBytes = await buildEditedPdf(baseBytes, [ann], { loadFontBytes: loadRealFontBytes })
      const fontNames = await getBaseFontNames(outBytes)

      // BaseFont contains Tinos variant
      expect(fontNames.some((f) => f.includes('Tinos'))).toBe(true)
      expect(fontNames.some((f) => f.includes(v.expectedSubstring))).toBe(true)

      // Does NOT contain Arimo
      expect(fontNames.some((f) => f.includes('Arimo'))).toBe(false)

      // pdf.js extracts exact string
      const extracted = await extractTextFromPdf(outBytes)
      expect(extracted).toContain(testText)
    }
  })

  // =========================================================================
  // K5: Regression - Times Roman with pure ASCII uses standard Times-Roman font
  // =========================================================================
  it('K5: exporting Times Roman with ASCII text uses standard Times-Roman font without embedding Tinos', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const baseBytes = new Uint8Array(await doc.save())

    const ann: Annotation = {
      id: 'ann-k5-ascii',
      page: 1,
      type: 'text',
      text: 'Contract No 01/2026 - Test Student 01, Test Road, Hanoi',
      fontFamily: 'Times Roman',
      bold: false,
      italic: false,
      fontSize: 14,
      color: '#000000',
      opacity: 1,
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.1,
    }

    const outBytes = await buildEditedPdf(baseBytes, [ann], { loadFontBytes: loadRealFontBytes })
    const fontNames = await getBaseFontNames(outBytes)

    // BaseFont is standard Times-Roman
    expect(fontNames.some((f) => f.includes('Times-Roman'))).toBe(true)
    // Tinos is NOT embedded
    expect(fontNames.some((f) => f.includes('Tinos'))).toBe(false)
  })

  // =========================================================================
  // K6: W-9 regression - replacement of Times Roman text with Vietnamese text
  // =========================================================================
  it('K6: replaces existing Times Roman text with Vietnamese text using Tinos and reports cleanedPages', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.TimesRoman)
    page.drawText('Hop dong so 01', { x: 50, y: 350, size: 14, font })
    const baseBytes = new Uint8Array(await doc.save())

    const pdfDoc = await pdfjsLib.getDocument({
      data: baseBytes.slice(),
      standardFontDataUrl,
    }).promise
    const pdfPage = await pdfDoc.getPage(1)
    const textContent = await pdfPage.getTextContent()
    const viewport = pdfPage.getViewport({ scale: 1.0 })

    const rawRegions = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )
    const r1 = rawRegions.find((r) => r.text.includes('Hop dong so 01'))!
    expect(r1).toBeDefined()
    expect(r1.fontFamily).toBe('Times Roman')

    const replacementAnn = buildReplacementAnnotation(r1, 'Hợp đồng số 02', rawRegions)
    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [replacementAnn], {
      loadFontBytes: loadRealFontBytes,
    })

    expect(report.cleanedPages).toContain(1)

    const fontNames = await getBaseFontNames(outBytes)
    expect(fontNames.some((f) => f.includes('Tinos'))).toBe(true)
    expect(fontNames.some((f) => f.includes('Arimo'))).toBe(false)

    const extracted = await extractTextFromPdf(outBytes)
    expect(extracted).toContain('Hợp đồng số 02')
    expect(extracted).not.toContain('Hop dong so 01')
  })
})
