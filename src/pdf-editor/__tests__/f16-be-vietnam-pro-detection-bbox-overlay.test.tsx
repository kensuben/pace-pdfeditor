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
import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  styleFromBaseFont,
  resolveExportFontFamily,
  probeTextStyles,
  enrichRegionsWithStyles,
  getPageView,
  groupTextItemsIntoLines,
  buildReplacementAnnotation,
  buildEditedPdfWithReport,
  EXPORT_FONT_FILES,
} from '../index'
import { PdfCanvas } from '../PdfCanvas'
import type { TextRegion, Annotation } from '../../types'

const fontsDir = path.resolve(__dirname, '../fonts')
const loadRealFontBytes = async (family: string, variant: string): Promise<ArrayBuffer> => {
  const familyKey = family as keyof typeof EXPORT_FONT_FILES
  const variantKey = variant as keyof (typeof EXPORT_FONT_FILES)[typeof familyKey]
  const file = EXPORT_FONT_FILES[familyKey]?.[variantKey]
  if (!file) throw new Error(`Unknown font ${family} ${variant}`)
  const buf = fs.readFileSync(path.join(fontsDir, file))
  return new Uint8Array(buf) as unknown as ArrayBuffer
}

describe('F-16: Be Vietnam Pro Font Detection & Bounding Box Overlay Suite', () => {
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
    vi.restoreAllMocks()
  })

  // =========================================================================
  // K1: styleFromBaseFont
  // =========================================================================
  it('K1: styleFromBaseFont correctly detects Be Vietnam Pro, Arimo, and preserves legacy families', () => {
    expect(styleFromBaseFont('BeVietnamPro-Regular-5465')).toEqual({
      family: 'Be Vietnam Pro',
      bold: false,
      italic: false,
    })
    expect(styleFromBaseFont('ABCDEF+BeVietnamPro-Bold')).toEqual({
      family: 'Be Vietnam Pro',
      bold: true,
      italic: false,
    })
    expect(styleFromBaseFont('BeVietnamPro-BoldItalic')).toEqual({
      family: 'Be Vietnam Pro',
      bold: true,
      italic: true,
    })
    expect(styleFromBaseFont('BeVietnamPro-SemiBold')).toEqual({
      family: 'Be Vietnam Pro',
      bold: true,
      italic: false,
    })
    expect(styleFromBaseFont('QWERTY+Arimo-Italic')).toEqual({
      family: 'Arimo',
      bold: false,
      italic: true,
    })

    // 4 legacy cases from W-9b K2 must remain identical
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
  // K2: probe + enrich on real Be Vietnam Pro fixture
  // =========================================================================
  it('K2: probeTextStyles and enrichRegionsWithStyles detects Be Vietnam Pro regular and bold', async () => {
    const regFontBytes = new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../fonts/BeVietnamPro-Regular.ttf')))
    const boldFontBytes = new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../fonts/BeVietnamPro-Bold.ttf')))

    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const page = doc.addPage([600, 400])
    const regFont = await doc.embedFont(regFontBytes, { subset: true })
    const boldFont = await doc.embedFont(boldFontBytes, { subset: true })

    page.drawText('Học viên Test 01', { x: 50, y: 350, size: 14, font: regFont })
    page.drawText('Điều 1. Nội dung', { x: 50, y: 300, size: 14, font: boldFont })
    const bytes = new Uint8Array(await doc.save())

    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const pdfPage = await pdfDoc.getPage(1)
    const textContent = await pdfPage.getTextContent()
    const viewport = pdfPage.getViewport({ scale: 1.0 })

    const rawRegions = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )

    const view = getPageView(doc.getPage(0))
    const probes = probeTextStyles(doc, 0)
    const enriched = enrichRegionsWithStyles(rawRegions, probes, view)

    const r1 = enriched.find((r) => r.text.includes('Học viên Test 01'))!
    const r2 = enriched.find((r) => r.text.includes('Điều 1. Nội dung'))!

    expect(r1).toBeDefined()
    expect(r2).toBeDefined()

    expect(r1.fontFamily).toBe('Be Vietnam Pro')
    expect(r1.bold).toBe(false)

    expect(r2.fontFamily).toBe('Be Vietnam Pro')
    expect(r2.bold).toBe(true)
  })

  // =========================================================================
  // K3: Export replaces text using Be Vietnam Pro (no Arimo in new fonts)
  // =========================================================================
  it('K3: export replaces region 1 with Be Vietnam Pro font, no Arimo font added, and updates text', async () => {
    const regFontBytes = new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../fonts/BeVietnamPro-Regular.ttf')))
    const boldFontBytes = new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../fonts/BeVietnamPro-Bold.ttf')))

    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const page = doc.addPage([600, 400])
    const regFont = await doc.embedFont(regFontBytes, { subset: true })
    const boldFont = await doc.embedFont(boldFontBytes, { subset: true })

    page.drawText('Học viên Test 01', { x: 50, y: 350, size: 14, font: regFont })
    page.drawText('Điều 1. Nội dung', { x: 50, y: 300, size: 14, font: boldFont })
    const bytes = new Uint8Array(await doc.save())

    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const pdfPage = await pdfDoc.getPage(1)
    const textContent = await pdfPage.getTextContent()
    const viewport = pdfPage.getViewport({ scale: 1.0 })

    const rawRegions = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )
    const view = getPageView(doc.getPage(0))
    const probes = probeTextStyles(doc, 0)
    const enriched = enrichRegionsWithStyles(rawRegions, probes, view)

    const r1 = enriched.find((r) => r.text.includes('Học viên Test 01'))!
    expect(r1.fontFamily).toBe('Be Vietnam Pro')

    // Verify resolveExportFontFamily keeps Be Vietnam Pro
    expect(resolveExportFontFamily(r1.fontFamily, 'Học viên Test 09')).toBe('Be Vietnam Pro')

    const ann = buildReplacementAnnotation(r1, 'Học viên Test 09', enriched)
    const { bytes: outBytes, report } = await buildEditedPdfWithReport(bytes, [ann], {
      loadFontBytes: loadRealFontBytes,
    })

    expect(report.cleanedPages).toContain(1)

    // Inspect exported doc fonts
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

    // Has font containing BeVietnamPro
    expect(fontNames.some((f) => f.includes('BeVietnamPro'))).toBe(true)
    // Does NOT contain Arimo
    expect(fontNames.some((f) => f.includes('Arimo'))).toBe(false)

    // Extract text with pdf.js: contains 'Học viên Test 09', does NOT contain 'Test 01'
    const outPdf = await pdfjsLib.getDocument({ data: outBytes.slice() }).promise
    const outPage = await outPdf.getPage(1)
    const outContent = await outPage.getTextContent()
    const allOutStrings = outContent.items
      .map((it: unknown) => ('str' in (it as { str: string }) ? (it as { str: string }).str : ''))
      .join(' ')

    expect(allOutStrings).toContain('Học viên Test 09')
    expect(allOutStrings).not.toContain('Test 01')
  })

  // =========================================================================
  // K4: jsdom - bounding box of region being edited is hidden, reappears on Esc
  // =========================================================================
  it('K4: hides bounding box of region being edited, keeps other regions, reappears on Esc', () => {
    const mockPdf = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, 1, 0, 0] }),
        getTextContent: () => ({ items: [], styles: {} }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      }),
    }

    const r1: TextRegion = {
      id: 'reg-1',
      page: 1,
      text: 'Vùng 1',
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.05,
      fontSize: 12,
      fontFamily: 'Helvetica',
      source: 'native',
    }
    const r2: TextRegion = {
      id: 'reg-2',
      page: 1,
      text: 'Vùng 2',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.05,
      fontSize: 12,
      fontFamily: 'Helvetica',
      source: 'native',
    }

    act(() => {
      root.render(
        <PdfCanvas
          // @ts-expect-error mock pdf
          pdf={mockPdf}
          pageNumber={1}
          zoom={1}
          annotations={[]}
          tool="select"
          color="#000000"
          showBoundingBoxes={true}
          onAdd={vi.fn()}
          onUpdate={vi.fn()}
          selectedId={null}
          onSelect={vi.fn()}
          textRegions={[r1, r2]}
          onTextRegions={vi.fn()}
          onEditRegion={vi.fn()}
          onEditAnnotation={vi.fn()}
        />,
      )
    })

    // Both bounding boxes are visible initially
    let bboxes = container.querySelectorAll('.bounding-box-region')
    expect(bboxes).toHaveLength(2)

    // Click region 1 button to start editing
    const r1Btn = container.querySelectorAll('button.text-region')[0] as HTMLButtonElement
    act(() => {
      r1Btn.click()
    })

    // Region 1 bounding box is hidden; region 2 bounding box remains
    bboxes = container.querySelectorAll('.bounding-box-region')
    expect(bboxes).toHaveLength(1)
    const remainingBbox = bboxes[0] as HTMLElement
    expect(remainingBbox.style.top).toBe('20%')

    // Press Esc in textarea to cancel editing
    const textarea = container.querySelector('textarea.inline-text-editor')!
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    // Both bounding boxes reappear
    bboxes = container.querySelectorAll('.bounding-box-region')
    expect(bboxes).toHaveLength(2)
  })

  // =========================================================================
  // K5: jsdom - bounding box of annotation being edited is hidden, reappears on Esc
  // =========================================================================
  it('K5: hides bounding box of annotation being edited, keeps other annotations, reappears on Esc', () => {
    const mockPdf = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, 1, 0, 0] }),
        getTextContent: () => ({ items: [], styles: {} }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      }),
    }

    const a1: Annotation = {
      id: 'ann-1',
      page: 1,
      type: 'text',
      text: 'Annotation 1',
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.05,
      color: '#000000',
      opacity: 1,
    }
    const a2: Annotation = {
      id: 'ann-2',
      page: 1,
      type: 'text',
      text: 'Annotation 2',
      x: 0.1,
      y: 0.25,
      width: 0.3,
      height: 0.05,
      color: '#000000',
      opacity: 1,
    }

    act(() => {
      root.render(
        <PdfCanvas
          // @ts-expect-error mock pdf
          pdf={mockPdf}
          pageNumber={1}
          zoom={1}
          annotations={[a1, a2]}
          tool="select"
          color="#000000"
          showBoundingBoxes={true}
          onAdd={vi.fn()}
          onUpdate={vi.fn()}
          selectedId={null}
          onSelect={vi.fn()}
          textRegions={[]}
          onTextRegions={vi.fn()}
          onEditRegion={vi.fn()}
          onEditAnnotation={vi.fn()}
        />,
      )
    })

    // Both annotation bounding boxes visible initially
    let bboxes = container.querySelectorAll('.bounding-box-annotation')
    expect(bboxes).toHaveLength(2)

    // Double-click annotation 1 to edit
    const ann1El = container.querySelectorAll('.annotation.text')[0] as HTMLElement
    act(() => {
      ann1El.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    // Annotation 1 bounding box is hidden; annotation 2 bounding box remains
    bboxes = container.querySelectorAll('.bounding-box-annotation')
    expect(bboxes).toHaveLength(1)
    const remainingBbox = bboxes[0] as HTMLElement
    expect(remainingBbox.style.top).toBe('25%')

    // Press Esc in textarea to cancel editing
    const textarea = container.querySelector('textarea.inline-text-editor')!
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    // Both annotation bounding boxes reappear
    bboxes = container.querySelectorAll('.bounding-box-annotation')
    expect(bboxes).toHaveLength(2)
  })
})
