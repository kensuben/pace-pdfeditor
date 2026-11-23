// @vitest-environment jsdom
if (typeof DOMMatrix === 'undefined') {
  // @ts-expect-error polyfill for jsdom
  globalThis.DOMMatrix = class DOMMatrix {}
}
// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFDict } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  familyFromFontLabel,
  styleFromBaseFont,
  cssFontStack,
  probeTextStyles,
  enrichRegionsWithStyles,
  groupTextItemsIntoLines,
  buildReplacementAnnotation,
  buildEditedPdfWithReport,
  getPageView,
  viewToPdf,
} from '../index'
import { readPageContent, writePageContent } from '../engine/pageContent'
import { tokenizeContent } from '../engine/contentTokenizer'
import { PdfCanvas } from '../PdfCanvas'
import type { TextRegion } from '../../types'

describe('W-9b: Text Recognition - Font, Weight, Color and Rotation Suite', () => {
  // =========================================================================
  // K1: familyFromFontLabel
  // =========================================================================
  it('K1: familyFromFontLabel correctly identifies font family and fixes sans-serif Times bug (B22)', () => {
    expect(familyFromFontLabel('g_d0_f1 sans-serif')).toBe('Helvetica')
    expect(familyFromFontLabel('g_d0_f2 serif')).toBe('Times Roman')
    expect(familyFromFontLabel('Times-Roman serif')).toBe('Times Roman')
    expect(familyFromFontLabel('CourierNewPSMT monospace')).toBe('Courier')
    expect(familyFromFontLabel('Arial-BoldMT sans-serif')).toBe('Helvetica')
    expect(familyFromFontLabel('Consolas mono')).toBe('Courier')
    expect(familyFromFontLabel('Georgia serif')).toBe('Times Roman')
  })

  // =========================================================================
  // K2: styleFromBaseFont
  // =========================================================================
  it('K2: styleFromBaseFont extracts family, bold, and italic from BaseFont names', () => {
    expect(styleFromBaseFont('ABCDEF+Arial-BoldMT')).toEqual({
      family: 'Helvetica',
      bold: true,
      italic: false,
    })
    expect(styleFromBaseFont('Times-Italic')).toEqual({
      family: 'Times Roman',
      bold: false,
      italic: true,
    })
    expect(styleFromBaseFont('Courier-BoldOblique')).toEqual({
      family: 'Courier',
      bold: true,
      italic: true,
    })
    expect(styleFromBaseFont('Helvetica')).toEqual({
      family: 'Helvetica',
      bold: false,
      italic: false,
    })
  })

  // =========================================================================
  // K3: probeTextStyles on pdf-lib fixture
  // =========================================================================
  async function createK3Fixture(): Promise<{ doc: PDFDocument; bytes: Uint8Array }> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const fHelv = await doc.embedFont(StandardFonts.Helvetica)
    const fHelvBold = await doc.embedFont(StandardFonts.HelveticaBold)
    const fTimesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic)

    // Line 1: Helvetica black
    page.drawText('Line 1: Normal Black Helvetica', {
      x: 50,
      y: 350,
      size: 14,
      font: fHelv,
      color: rgb(0, 0, 0),
    })

    // Line 2: Helvetica-Bold red rgb(0.8, 0.1, 0.1)
    page.drawText('Line 2: Bold Red Helvetica', {
      x: 50,
      y: 300,
      size: 14,
      font: fHelvBold,
      color: rgb(0.8, 0.1, 0.1),
    })

    // Line 3: Times-Italic blue rgb(0, 0.2, 0.6)
    page.drawText('Line 3: Italic Blue Times', {
      x: 50,
      y: 250,
      size: 14,
      font: fTimesItalic,
      color: rgb(0, 0.2, 0.6),
    })

    // Append invisible OCR line with Tr 3
    const origContent = readPageContent(doc, 0)
    const tr3Op = new TextEncoder().encode('\nBT /F1 14 Tf 3 Tr 50 150 Td (Line 4: Invisible OCR Text) Tj ET\n')
    const combined = new Uint8Array(origContent.length + tr3Op.length)
    combined.set(origContent, 0)
    combined.set(tr3Op, origContent.length)
    writePageContent(doc, 0, combined)

    const bytes = new Uint8Array(await doc.save())
    const loadedDoc = await PDFDocument.load(bytes)
    return { doc: loadedDoc, bytes }
  }

  it('K3: probeTextStyles accurately extracts bbox, color and BaseFont and skips Tr 3', async () => {
    const { doc } = await createK3Fixture()
    const probes = probeTextStyles(doc, 0)

    // Exactly 3 probes (Line 4 Tr 3 is skipped)
    expect(probes).toHaveLength(3)

    // Line 1: Helvetica black
    const p1 = probes[0]
    expect(Math.abs(p1.bbox.x - 50)).toBeLessThanOrEqual(2)
    expect(Math.abs(p1.bbox.y - 350)).toBeLessThanOrEqual(4)
    expect(p1.color).toBe('#000000')
    expect(p1.baseFont).toBe('Helvetica')

    // Line 2: Helvetica-Bold red rgb(0.8, 0.1, 0.1) -> #cc1a1a
    const p2 = probes[1]
    expect(Math.abs(p2.bbox.x - 50)).toBeLessThanOrEqual(2)
    expect(Math.abs(p2.bbox.y - 300)).toBeLessThanOrEqual(4)
    expect(p2.color).toBe('#cc1a1a')
    expect(p2.baseFont).toBe('Helvetica-Bold')

    // Line 3: Times-Italic blue rgb(0, 0.2, 0.6) -> #003399
    const p3 = probes[2]
    expect(Math.abs(p3.bbox.x - 50)).toBeLessThanOrEqual(2)
    expect(Math.abs(p3.bbox.y - 250)).toBeLessThanOrEqual(4)
    expect(p3.color).toBe('#003399')
    expect(p3.baseFont).toBe('Times-Italic')
  })

  // =========================================================================
  // K4: enrichRegionsWithStyles + groupTextItemsIntoLines on K3 fixture
  // =========================================================================
  it('K4: enrichRegionsWithStyles enriches native regions with font, weight, and color', async () => {
    const { doc, bytes } = await createK3Fixture()
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const page = await pdfDoc.getPage(1)
    const textContent = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1.0 })

    const rawRegions = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )

    const view = getPageView(doc.getPage(0))
    const probes = probeTextStyles(doc, 0)
    const enriched = enrichRegionsWithStyles(rawRegions, probes, view)

    const r1 = enriched.find((r) => r.text.includes('Line 1'))!
    const r2 = enriched.find((r) => r.text.includes('Line 2'))!
    const r3 = enriched.find((r) => r.text.includes('Line 3'))!

    // Line 1: Helvetica (B22 fixed: not Times Roman)
    expect(r1.fontFamily).toBe('Helvetica')

    // Line 2: Helvetica, bold: true, color: #cc1a1a
    expect(r2.fontFamily).toBe('Helvetica')
    expect(r2.bold).toBe(true)
    expect(r2.color).toBe('#cc1a1a')

    // Line 3: Times Roman, italic: true, color: #003399
    expect(r3.fontFamily).toBe('Times Roman')
    expect(r3.italic).toBe(true)
    expect(r3.color).toBe('#003399')
  })

  // =========================================================================
  // K5: Rotated text on page /Rotate 90
  // =========================================================================
  it('K5: rotated text on /Rotate 90 page generates separate regions with rotation angle and valid PDF bbox', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.setRotation(degrees(90))
    const font = await doc.embedFont(StandardFonts.Helvetica)

    page.drawText('Customer: Hoc vien Test 01', { x: 50, y: 300, size: 14, font })
    page.drawText('Line C', { x: 50, y: 250, size: 14, font })

    const bytes = new Uint8Array(await doc.save())
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const pdfPage = await pdfDoc.getPage(1)
    const textContent = await pdfPage.getTextContent()
    const viewport = pdfPage.getViewport({ scale: 1.0 })

    const regions = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )

    // Two separate regions, both having rotation
    expect(regions.length).toBeGreaterThanOrEqual(2)
    const regCust = regions.find((r) => r.text.includes('Hoc vien Test 01'))!
    const regLineC = regions.find((r) => r.text.includes('Line C'))!

    expect(regCust).toBeDefined()
    expect(regLineC).toBeDefined()
    expect(regCust.id).not.toBe(regLineC.id)
    expect(regCust.rotation).toBeDefined()
    expect(regLineC.rotation).toBeDefined()

    // Convert regCust box to PDF coordinates using viewToPdf
    const view = getPageView(doc.getPage(0))
    const c1 = viewToPdf(view, regCust.x, regCust.y)
    const c2 = viewToPdf(view, regCust.x + regCust.width, regCust.y)
    const c3 = viewToPdf(view, regCust.x + regCust.width, regCust.y + regCust.height)
    const c4 = viewToPdf(view, regCust.x, regCust.y + regCust.height)

    const minX = Math.min(c1.x, c2.x, c3.x, c4.x)
    const maxX = Math.max(c1.x, c2.x, c3.x, c4.x)
    const minY = Math.min(c1.y, c2.y, c3.y, c4.y)
    const maxY = Math.max(c1.y, c2.y, c3.y, c4.y)

    // True drawn coordinates: x: 50, y: ~300 to ~314
    expect(Math.abs(minX - 50)).toBeLessThanOrEqual(2)
    expect(maxX).toBeGreaterThan(150) // covers text advance
    expect(Math.abs(minY - 300)).toBeLessThanOrEqual(2)
    expect(maxY).toBeGreaterThanOrEqual(312)

    // Does NOT contain Line C (y: 250)
    expect(minY).toBeGreaterThan(260)
  })

  // =========================================================================
  // K6: cssFontStack + jsdom render
  // =========================================================================
  describe('K6: cssFontStack & inline editor font rendering', () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    })

    afterEach(() => {
      act(() => {
        root.unmount()
      })
      container.remove()
    })

    it('cssFontStack returns correct font fallbacks for all 6 cases', () => {
      expect(cssFontStack('Times Roman')).toBe('"Times New Roman", Times, "Liberation Serif", serif')
      expect(cssFontStack('Courier')).toBe('"Courier New", Courier, "Liberation Mono", monospace')
      expect(cssFontStack('Arimo')).toBe('Arimo, Arial, sans-serif')
      expect(cssFontStack('Be Vietnam Pro')).toBe('"Be Vietnam Pro", sans-serif')
      expect(cssFontStack('Noto Sans')).toBe('"Noto Sans", sans-serif')
      expect(cssFontStack('Helvetica')).toBe('Helvetica, Arimo, Arial, sans-serif')
      expect(cssFontStack()).toBe('Helvetica, Arimo, Arial, sans-serif')
    })

    it('renders PdfCanvas and when editing Helvetica region, textarea style contains Arimo', () => {
      const mockPdf = {
        getPage: vi.fn().mockResolvedValue({
          getViewport: () => ({ width: 600, height: 400 }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
          getTextContent: () => Promise.resolve({ items: [] }),
        }),
      } as unknown as pdfjsLib.PDFDocumentProxy

      const region: TextRegion = {
        id: 'reg-helv-1',
        page: 1,
        text: 'Helvetica Sample',
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.05,
        fontSize: 14,
        fontFamily: 'Helvetica',
        source: 'native',
      }

      act(() => {
        root.render(
          <PdfCanvas
            pdf={mockPdf}
            pageNumber={1}
            zoom={1}
            annotations={[]}
            tool="select"
            color="#000000"
            onAdd={vi.fn()}
            onUpdate={vi.fn()}
            selectedId={null}
            onSelect={vi.fn()}
            textRegions={[region]}
            onTextRegions={vi.fn()}
            onEditRegion={vi.fn()}
            onEditAnnotation={vi.fn()}
          />,
        )
      })

      // Click on region button to open inline editor
      const btn = container.querySelector<HTMLButtonElement>('button.text-region')!
      expect(btn).not.toBeNull()

      act(() => {
        btn.click()
      })

      const textarea = container.querySelector<HTMLTextAreaElement>('textarea.inline-text-editor')!
      expect(textarea).not.toBeNull()
      expect(textarea.style.fontFamily).toContain('Arimo')
    })
  })

  // =========================================================================
  // K7: Rotated region button in PdfCanvas (jsdom)
  // =========================================================================
  describe('K7: Rotated region in PdfCanvas', () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    })

    afterEach(() => {
      act(() => {
        root.unmount()
      })
      container.remove()
    })

    it('renders rotated region with aria-disabled=true and clicking does not open editor', () => {
      const mockPdf = {
        getPage: vi.fn().mockResolvedValue({
          getViewport: () => ({ width: 600, height: 400 }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
          getTextContent: () => Promise.resolve({ items: [] }),
        }),
      } as unknown as pdfjsLib.PDFDocumentProxy

      const rotatedRegion: TextRegion = {
        id: 'reg-rot-1',
        page: 1,
        text: 'Rotated Region Text',
        x: 0.1,
        y: 0.2,
        width: 0.05,
        height: 0.3,
        fontSize: 14,
        fontFamily: 'Helvetica',
        source: 'native',
        rotation: 90,
      }

      act(() => {
        root.render(
          <PdfCanvas
            pdf={mockPdf}
            pageNumber={1}
            zoom={1}
            annotations={[]}
            tool="select"
            color="#000000"
            onAdd={vi.fn()}
            onUpdate={vi.fn()}
            selectedId={null}
            onSelect={vi.fn()}
            textRegions={[rotatedRegion]}
            onTextRegions={vi.fn()}
            onEditRegion={vi.fn()}
            onEditAnnotation={vi.fn()}
          />,
        )
      })

      const btn = container.querySelector<HTMLButtonElement>('button.text-region.rotated')!
      expect(btn).not.toBeNull()
      expect(btn.getAttribute('aria-disabled')).toBe('true')
      expect(btn.title).toBe('Chữ xoay: chưa hỗ trợ sửa')

      // Clicking must not open inline textarea
      act(() => {
        btn.click()
      })

      const textarea = container.querySelector('textarea.inline-text-editor')
      expect(textarea).toBeNull()
    })
  })

  // =========================================================================
  // K8: Export regression with enriched region
  // =========================================================================
  it('K8: export regression with enriched region embeds Helvetica-Bold and rgb operator', async () => {
    const { doc, bytes } = await createK3Fixture()
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const page = await pdfDoc.getPage(1)
    const textContent = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1.0 })

    const rawRegions = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )

    const view = getPageView(doc.getPage(0))
    const probes = probeTextStyles(doc, 0)
    const enriched = enrichRegionsWithStyles(rawRegions, probes, view)

    // Line 2: red bold Helvetica
    const r2 = enriched.find((r) => r.text.includes('Line 2'))!
    expect(r2.color).toBe('#cc1a1a')
    expect(r2.bold).toBe(true)

    const ann = buildReplacementAnnotation(r2, 'Line 2: Replacement Text', enriched)
    const { bytes: outBytes, report } = await buildEditedPdfWithReport(bytes, [ann])

    expect(report.cleanedPages).toContain(1)

    // Inspect exported PDF fonts
    const loaded = await PDFDocument.load(outBytes)
    const p0 = loaded.getPage(0)
    const fontDict = p0.node.Resources()?.lookup(PDFName.of('Font'))
    const fontNames: string[] = []
    if (fontDict instanceof PDFDict) {
      for (const ref of fontDict.values()) {
        const resolved = loaded.context.lookup(ref)
        if (resolved instanceof PDFDict) {
          const bf = resolved.lookup(PDFName.of('BaseFont'))
          if (bf instanceof PDFName) fontNames.push(bf.asString())
        }
      }
    }

    // Has Helvetica-Bold, does NOT have Times-Roman
    expect(fontNames.some((f) => f.includes('Helvetica-Bold') || f.includes('HelveticaBold'))).toBe(true)
    expect(fontNames.some((f) => f.includes('Times-Roman'))).toBe(false)

    // Content stream has 0.8 0.1 0.1 rg operator for the replacement text
    const content = readPageContent(loaded, 0)
    const ops = tokenizeContent(content)
    const rgOps = ops.filter(
      (o) =>
        o.operator === 'rg' &&
        o.operands.length === 3 &&
        Math.abs((o.operands[0] as { value: number }).value - 0.8) <= 0.02 &&
        Math.abs((o.operands[1] as { value: number }).value - 0.1) <= 0.02 &&
        Math.abs((o.operands[2] as { value: number }).value - 0.1) <= 0.02,
    )
    expect(rgOps.length).toBeGreaterThanOrEqual(1)
  })

  // =========================================================================
  // Benchmark: probeTextStyles on 200 lines (3 runs median)
  // =========================================================================
  it('benchmark: probeTextStyles on 200-line document runs efficiently', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 3200])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 200; i++) {
      page.drawText(`Line ${i}: Sample text for probing benchmarks 12345`, {
        x: 50,
        y: 3150 - i * 15,
        size: 11,
        font,
      })
    }

    const times: number[] = []
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now()
      const probes = probeTextStyles(doc, 0)
      const t1 = performance.now()
      expect(probes).toHaveLength(200)
      times.push(t1 - t0)
    }

    times.sort((a, b) => a - b)
    const median = times[1]
    console.log(`[W-9b Benchmark] 200 lines probeTextStyles: ${times.map((t) => t.toFixed(2) + 'ms').join(', ')} (median: ${median.toFixed(2)}ms)`)
    expect(median).toBeLessThan(200) // Expect < 200ms
  })
})
