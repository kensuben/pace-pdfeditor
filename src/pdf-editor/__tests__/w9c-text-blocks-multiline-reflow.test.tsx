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
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  groupLinesIntoBlocks,
  wrapTextToWidth,
  groupTextItemsIntoLines,
  buildReplacementAnnotation,
  buildEditedPdfWithReport,
} from '../index'
import { readPageContent } from '../engine/pageContent'
import { tokenizeContent } from '../engine/contentTokenizer'
import { PdfCanvas } from '../PdfCanvas'
import type { TextRegion } from '../../types'

describe('W-9c: Text Blocks & Multi-line Reflow Suite', () => {
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
  // K1: groupLinesIntoBlocks - standard 3 lines merged + 1 separate line
  // =========================================================================
  it('K1: groups 3 consecutive lines into 1 block with lineHeight approx 15 and keeps distant line separate', () => {
    const vp = { width: 600, height: 800 }
    const l1: TextRegion = {
      id: 'l1',
      page: 1,
      text: 'dòng1',
      x: 70 / 600,
      y: 100 / 800,
      width: 400 / 600,
      height: 12 / 800,
      fontSize: 12,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }
    const l2: TextRegion = {
      id: 'l2',
      page: 1,
      text: 'dòng2',
      x: 70 / 600,
      y: 115 / 800, // baseline diff = 15pt
      width: 395 / 600,
      height: 12 / 800,
      fontSize: 12,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }
    const l3: TextRegion = {
      id: 'l3',
      page: 1,
      text: 'dòng3',
      x: 70 / 600,
      y: 130 / 800, // baseline diff = 15pt
      width: 150 / 600, // short line at end of paragraph
      height: 12 / 800,
      fontSize: 12,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }
    const l4: TextRegion = {
      id: 'l4',
      page: 1,
      text: 'dòng4',
      x: 70 / 600,
      y: 170 / 800, // 40pt below l3 (> 1.8 * 12 = 21.6pt)
      width: 300 / 600,
      height: 12 / 800,
      fontSize: 12,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }

    const blocks = groupLinesIntoBlocks([l1, l2, l3, l4], vp, 1)
    expect(blocks).toHaveLength(2)

    const block1 = blocks[0]
    expect(block1.id).toBe('native-block-1-1')
    expect(block1.text).toBe('dòng1 dòng2 dòng3')
    expect(block1.lineRects).toHaveLength(3)
    expect(block1.lineHeight).toBeCloseTo(15, 1)
    expect(block1.fontSize).toBe(12)

    const block2 = blocks[1]
    expect(block2.id).toBe('l4')
    expect(block2.text).toBe('dòng4')
    expect(block2.lineRects).toBeUndefined()
  })

  // =========================================================================
  // K2: Form 3 rows - label | value pairs must remain 6 separate regions
  // =========================================================================
  it('K2: 3-row form with label and value on same row keeps 6 separate regions due to condition b', () => {
    const vp = { width: 600, height: 800 }
    const regions: TextRegion[] = [
      // Row 1
      {
        id: 'r1-lbl',
        page: 1,
        text: 'Họ và tên:',
        x: 70 / 600,
        y: 100 / 800,
        width: 80 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
      {
        id: 'r1-val',
        page: 1,
        text: 'Học viên Test 01',
        x: 200 / 600,
        y: 100 / 800,
        width: 150 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
      // Row 2
      {
        id: 'r2-lbl',
        page: 1,
        text: 'Email:',
        x: 70 / 600,
        y: 120 / 800,
        width: 80 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
      {
        id: 'r2-val',
        page: 1,
        text: 'hocvien01@example.com',
        x: 200 / 600,
        y: 120 / 800,
        width: 180 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
      // Row 3
      {
        id: 'r3-lbl',
        page: 1,
        text: 'Số điện thoại:',
        x: 70 / 600,
        y: 140 / 800,
        width: 80 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
      {
        id: 'r3-val',
        page: 1,
        text: '0901234567',
        x: 200 / 600,
        y: 140 / 800,
        width: 100 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
    ]

    const blocks = groupLinesIntoBlocks(regions, vp, 1)
    expect(blocks).toHaveLength(6)
    expect(blocks.every((b) => b.lineRects === undefined)).toBe(true)
  })

  // =========================================================================
  // K3: List of 3 short lines - joins with \n
  // =========================================================================
  it('K3: list of 3 items joins into 1 block with newline separators', () => {
    const vp = { width: 600, height: 800 }
    const items: TextRegion[] = [
      {
        id: 'item1',
        page: 1,
        text: '• Mục 1',
        x: 70 / 600,
        y: 100 / 800,
        width: 80 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
      {
        id: 'item2',
        page: 1,
        text: '• Mục 2',
        x: 70 / 600,
        y: 115 / 800,
        width: 80 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
      {
        id: 'item3',
        page: 1,
        text: '• Mục 3',
        x: 70 / 600,
        y: 130 / 800,
        width: 80 / 600,
        height: 12 / 800,
        fontSize: 12,
        fontFamily: 'Helvetica',
        bold: false,
        italic: false,
        color: '#000000',
        align: 'left',
        source: 'native',
      },
    ]

    const blocks = groupLinesIntoBlocks(items, vp, 1)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('• Mục 1\n• Mục 2\n• Mục 3')
    expect(blocks[0].lineRects).toHaveLength(3)
  })

  // =========================================================================
  // K4: Font size or bold difference - does not merge title into paragraph
  // =========================================================================
  it('K4: different font size (18pt title vs 12pt body) or bold does not merge', () => {
    const vp = { width: 600, height: 800 }
    const title: TextRegion = {
      id: 'title',
      page: 1,
      text: 'Tiêu đề tài liệu mẫu',
      x: 70 / 600,
      y: 100 / 800,
      width: 300 / 600,
      height: 18 / 800,
      fontSize: 18,
      fontFamily: 'Helvetica',
      bold: true,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }
    const body: TextRegion = {
      id: 'body',
      page: 1,
      text: 'Nội dung đoạn văn bản thứ nhất bắt đầu ở đây.',
      x: 70 / 600,
      y: 125 / 800,
      width: 400 / 600,
      height: 12 / 800,
      fontSize: 12,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }

    const blocks = groupLinesIntoBlocks([title, body], vp, 1)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].id).toBe('title')
    expect(blocks[1].id).toBe('body')
  })

  // =========================================================================
  // K5: First-line indent of 20pt (fontSize 12) still merges into 1 block
  // =========================================================================
  it('K5: first line indentation of 20pt still merges into 1 block', () => {
    const vp = { width: 600, height: 800 }
    const l1: TextRegion = {
      id: 'l1',
      page: 1,
      text: 'Đoạn văn bắt đầu với thụt đầu dòng 20pt.',
      x: 90 / 600, // indented 20pt from margin 70pt
      y: 100 / 800,
      width: 380 / 600,
      height: 12 / 800,
      fontSize: 12,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }
    const l2: TextRegion = {
      id: 'l2',
      page: 1,
      text: 'Dòng thứ hai tiếp tục từ lề trái chuẩn của đoạn văn.',
      x: 70 / 600,
      y: 115 / 800,
      width: 400 / 600,
      height: 12 / 800,
      fontSize: 12,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }
    const l3: TextRegion = {
      id: 'l3',
      page: 1,
      text: 'Dòng thứ ba kết thúc đoạn văn ngắn.',
      x: 70 / 600,
      y: 130 / 800,
      width: 250 / 600,
      height: 12 / 800,
      fontSize: 12,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
    }

    const blocks = groupLinesIntoBlocks([l1, l2, l3], vp, 1)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lineRects).toHaveLength(3)
  })

  // =========================================================================
  // K6: Real pdf.js fixture - 3-line paragraph + 2-row form
  // =========================================================================
  it('K6: real pdf.js extraction produces 1 block (3 lines) and 4 form regions', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    page.drawText('Hoc vien tham gia khoa hoc can tuan thu quy dinh.', { x: 70, y: 700, size: 12, font })
    page.drawText('Moi hoc vien phai hoan thanh day du cac bai tap duoc giao.', { x: 70, y: 685, size: 12, font })
    page.drawText('Ket qua hoc tap se duoc danh gia vao cuoi ky.', { x: 70, y: 670, size: 12, font })

    // 2-row form
    page.drawText('Ho va ten:', { x: 70, y: 600, size: 12, font })
    page.drawText('Hoc vien Test 01', { x: 200, y: 600, size: 12, font })
    page.drawText('Email lien he:', { x: 70, y: 580, size: 12, font })
    page.drawText('hocvien01@example.com', { x: 200, y: 580, size: 12, font })

    const bytes = new Uint8Array(await doc.save())
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const pdfPage = await pdfDoc.getPage(1)
    const textContent = await pdfPage.getTextContent()
    const viewport = pdfPage.getViewport({ scale: 1.0 })

    const rawLines = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )

    const regions = groupLinesIntoBlocks(rawLines, viewport, 1)

    // Expected: 1 block of 3 lines + 4 form line regions = 5 regions total
    expect(regions).toHaveLength(5)
    const multiLineBlock = regions.find((r) => r.lineRects && r.lineRects.length === 3)
    expect(multiLineBlock).toBeDefined()
    expect(multiLineBlock!.text).toContain('Hoc vien tham gia')
    expect(multiLineBlock!.text).toContain('Ket qua hoc tap')

    const formRegions = regions.filter((r) => !r.lineRects)
    expect(formRegions).toHaveLength(4)
  })

  // =========================================================================
  // K7: wrapTextToWidth
  // =========================================================================
  it('K7: wrapTextToWidth respects maxWidth, breaks on spaces/newlines, and cuts long words', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const measure = (s: string) => font.widthOfTextAtSize(s, 12)

    // Part 1: 3 long sentences wrapped at 200pt
    const text1 =
      'Dieu 1 quy dinh ve pham vi dieu chinh cua quy che dao tao. ' +
      'Moi hoc vien co nghia vu chap hanh nghiem tuc cac noi quy da ban hanh. ' +
      'Moi vi pham se bi xu ly theo dung quy dinh cua nha truong.'
    const lines1 = wrapTextToWidth(text1, 200, measure)
    expect(lines1.length).toBeGreaterThan(3)
    for (const l of lines1) {
      expect(measure(l)).toBeLessThanOrEqual(200)
    }
    // Joining by spaces restores all words in exact order
    expect(lines1.join(' ')).toBe(text1)

    // Part 2: Explicit newlines
    const text2 = 'Dong mot rat ngan\nDong hai dai hon mot chut\nDong ba ket thuc'
    const lines2 = wrapTextToWidth(text2, 200, measure)
    expect(lines2).toHaveLength(3)
    expect(lines2[0]).toBe('Dong mot rat ngan')
    expect(lines2[1]).toBe('Dong hai dai hon mot chut')
    expect(lines2[2]).toBe('Dong ba ket thuc')

    // Part 3: 60-character unbreakable word cut by character without losing chars
    const longWord = 'A'.repeat(60)
    const lines3 = wrapTextToWidth(longWord, 200, measure)
    expect(lines3.length).toBeGreaterThan(1)
    for (const l of lines3) {
      expect(measure(l)).toBeLessThanOrEqual(200)
    }
    expect(lines3.join('')).toBe(longWord)
  })

  // =========================================================================
  // K8: Export with real pdf.js extraction - replaces 3 lines without downsizing font
  // =========================================================================
  it('K8: replaces 3 lines with longer text, cleans original text, keeps exact original font size (no downscaling)', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    page.drawText('Dong 1 cua van ban hop dong mau.', { x: 70, y: 700, size: 12, font })
    page.drawText('Dong 2 quy dinh chi tiet ve thoi han thuc hien cong viec.', { x: 70, y: 685, size: 12, font })
    page.drawText('Dong 3 ghi ro cac cam ket khac giua hai ben tham gia.', { x: 70, y: 670, size: 12, font })

    const bytes = new Uint8Array(await doc.save())
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    const pdfPage = await pdfDoc.getPage(1)
    const textContent = await pdfPage.getTextContent()
    const viewport = pdfPage.getViewport({ scale: 1.0 })

    const rawLines = groupTextItemsIntoLines(
      textContent.items,
      textContent.styles,
      { transform: viewport.transform, width: viewport.width, height: viewport.height },
      1,
    )
    const blocks = groupLinesIntoBlocks(rawLines, viewport, 1)
    const blockRegion = blocks.find((b) => b.lineRects && b.lineRects.length === 3)!
    expect(blockRegion).toBeDefined()

    // Replacement text is much longer (5 lines)
    const replacementText =
      'Dieu 1 duoc sua doi bo sung thanh mot doan van ban dai hon rat nhieu de kiem tra tinh nang tu dong xuong dong. ' +
      'Cac ben thong nhat gia han them thoi gian thuc hien them muoi hai thang ke tu ngay ky ket.'

    const ann = buildReplacementAnnotation(blockRegion, replacementText, blocks)
    const { bytes: outBytes, report } = await buildEditedPdfWithReport(bytes, [ann])

    expect(report.cleanedPages).toContain(1)

    // Inspect with pdf.js: none of the old text remains
    const outPdf = await pdfjsLib.getDocument({ data: outBytes.slice() }).promise
    const outPage = await outPdf.getPage(1)
    const outContent = await outPage.getTextContent()
    const outStrings = outContent.items.map((it: unknown) => ('str' in (it as { str: string }) ? (it as { str: string }).str : ''))
    const fullOutText = outStrings.join(' ')

    expect(fullOutText).not.toContain('Dong 1 cua van ban')
    expect(fullOutText).not.toContain('Dong 2 quy dinh')
    expect(fullOutText).not.toContain('Dong 3 ghi ro')

    // New text is present across multiple lines
    expect(fullOutText).toContain('Dieu 1 duoc sua doi')
    expect(fullOutText).toContain('muoi hai thang')

    // Inspect content stream: Tf operator should have size 12 (NOT downscaled!)
    const loadedDoc = await PDFDocument.load(outBytes)
    const streamContent = readPageContent(loadedDoc, 0)
    const ops = tokenizeContent(streamContent)
    const tfOps = ops.filter((o) => o.operator === 'Tf')
    const sizes = tfOps.map((o) => (o.operands[1] as { value: number }).value)
    // Every Tf used for drawing the text must have size 12
    expect(sizes.some((s) => Math.abs(s - 12) < 0.1)).toBe(true)
    expect(sizes.every((s) => s >= 12)).toBe(true)
  })

  // =========================================================================
  // K9: Overflow - 3x longer text records overflowPages = [1]
  // =========================================================================
  it('K9: 3x longer text records page 1 in overflowPages while drawing all text', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Customer: Hoc vien Test 01', { x: 50, y: 700, size: 12, font })
    const bytes = new Uint8Array(await doc.save())

    const ann = {
      id: 'overflow-ann',
      page: 1,
      type: 'text' as const,
      x: 50 / 600,
      y: (800 - 700 - 12) / 800,
      width: 150 / 600,
      height: 15 / 800, // height only fits 1 line
      fontSize: 12,
      lineHeight: 14.4,
      color: '#000000',
      opacity: 1,
      replaceOriginal: true,
      text: 'Doan van ban nay rat dai gap ba lan khung de kiem tra co che phat hien tran trang cua he thong xuat tai lieu PDF.',
    }

    const { report } = await buildEditedPdfWithReport(bytes, [ann])
    expect(report.overflowPages).toEqual([1])
  })

  // =========================================================================
  // K10: Regression check - single line replacement produces exact drawText
  // =========================================================================
  it('K10: single line replacement produces exact single drawText call matching expected sequence', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Customer: Hoc vien Test 01', { x: 50, y: 350, size: 12, font })
    const baseBytes = new Uint8Array(await doc.save())

    const ann = {
      id: 'single-line-ann',
      page: 1,
      type: 'text' as const,
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

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [ann])
    expect(report.overflowPages).toEqual([])
    expect(report.cleanedPages).toEqual([1])

    const outDoc = await PDFDocument.load(outBytes)
    const streamContent = readPageContent(outDoc, 0)
    const ops = tokenizeContent(streamContent)
    const tjOps = ops.filter((o) => o.operator === 'Tj')
    expect(tjOps).toHaveLength(1)
  })

  // =========================================================================
  // K11: jsdom inline editing - textarea title, lineHeight, Shift+Enter and Enter
  // =========================================================================
  it('K11: clicking block region renders textarea with title, lineHeight, Shift+Enter adds newline, Enter saves', () => {
    const mockPdf = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, 1, 0, 0] }),
        getTextContent: () => ({ items: [], styles: {} }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      }),
    }

    const blockRegion: TextRegion = {
      id: 'native-block-1-1',
      page: 1,
      text: 'Dòng một\nDòng hai',
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.05,
      fontSize: 12,
      lineHeight: 15,
      fontFamily: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      align: 'left',
      source: 'native',
      lineRects: [
        { x: 0.1, y: 0.1, width: 0.5, height: 0.02 },
        { x: 0.1, y: 0.13, width: 0.5, height: 0.02 },
      ],
    }

    const onEditRegion = vi.fn()

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
          onAdd={vi.fn()}
          onUpdate={vi.fn()}
          selectedId={null}
          onSelect={vi.fn()}
          textRegions={[blockRegion]}
          onTextRegions={vi.fn()}
          onEditRegion={onEditRegion}
          onEditAnnotation={vi.fn()}
        />,
      )
    })

    const btn = container.querySelector<HTMLButtonElement>('button.text-region')!
    expect(btn).not.toBeNull()

    // Click to start inline editing
    act(() => {
      btn.click()
    })

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.inline-text-editor')!
    expect(textarea).not.toBeNull()
    expect(textarea.title).toBe('Enter: lưu · Shift+Enter: xuống dòng · Esc: huỷ')
    expect(textarea.style.lineHeight).toBe('15px')
    expect(textarea.style.whiteSpace).toBe('pre-wrap')

    // Change value to multiline text
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      if (nativeSetter) {
        nativeSetter.call(textarea, 'Dòng một\nDòng hai\nDòng ba')
      } else {
        textarea.value = 'Dòng một\nDòng hai\nDòng ba'
      }
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Shift+Enter should NOT submit, but keep editing
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      )
    })
    expect(onEditRegion).not.toHaveBeenCalled()

    // Plain Enter submits
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true }),
      )
    })
    expect(onEditRegion).toHaveBeenCalledTimes(1)
    expect(onEditRegion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'native-block-1-1' }),
      'Dòng một\nDòng hai\nDòng ba',
    )
  })
})
