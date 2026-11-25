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
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import type { Annotation, PageImageRegion } from '../../types'
import {
  probePageImages,
  applyImageEdits,
  pdfToView,
  getPageView,
  viewToPdf,
  canRotatePage,
  buildEditedPdfWithReport,
  formatRemainingTextWarning,
} from '../index'
import { readPageContent } from '../engine/pageContent'
import { PdfCanvas } from '../PdfCanvas'

// 1x1 transparent PNG bytes
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

describe('W-10a: Existing PDF Images (select, move, resize, delete) Suite', () => {
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

  // =========================================================================
  // K1: probePageImages
  // =========================================================================
  it('K1: probePageImages identifies 2 axisAligned PNG images, 1 30-deg rotated image, and skips 1 Form XObject', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const png = await doc.embedPng(TINY_PNG)

    // Image 1: (50, 600, 100, 50)
    page.drawImage(png, { x: 50, y: 600, width: 100, height: 50 })
    // Image 2: (300, 100, 80, 80)
    page.drawImage(png, { x: 300, y: 100, width: 80, height: 80 })

    // Form XObject: embed second doc page and draw
    const doc2 = await PDFDocument.create()
    const p2 = doc2.addPage([100, 100])
    p2.drawText('Form Page', { x: 10, y: 10, size: 10 })
    const [embeddedForm] = await doc.embedPdf(doc2, [0])
    page.drawPage(embeddedForm, { x: 10, y: 10, width: 60, height: 60 })

    // Image 3: rotated 30 degrees
    page.drawImage(png, { x: 200, y: 200, width: 50, height: 50, rotate: degrees(30) })

    const savedBytes = await doc.save()
    const reloadedDoc = await PDFDocument.load(savedBytes)

    const res = probePageImages(reloadedDoc, 0)

    expect(res.images.length).toBe(3)
    expect(res.skipped.formXObject).toBe(1)
    expect(res.skipped.inline).toBe(0)

    const aligned = res.images.filter((img) => img.axisAligned)
    const nonAligned = res.images.filter((img) => !img.axisAligned)

    expect(aligned.length).toBe(2)
    expect(nonAligned.length).toBe(1)

    // Verify bboxes for aligned images (±0.5pt)
    const img1 = aligned.find((i) => Math.abs(i.bbox.x - 50) < 0.5)!
    expect(img1).toBeDefined()
    expect(Math.abs(img1.bbox.y - 600)).toBeLessThan(0.5)
    expect(Math.abs(img1.bbox.width - 100)).toBeLessThan(0.5)
    expect(Math.abs(img1.bbox.height - 50)).toBeLessThan(0.5)

    const img2 = aligned.find((i) => Math.abs(i.bbox.x - 300) < 0.5)!
    expect(img2).toBeDefined()
    expect(Math.abs(img2.bbox.y - 100)).toBeLessThan(0.5)
    expect(Math.abs(img2.bbox.width - 80)).toBeLessThan(0.5)
    expect(Math.abs(img2.bbox.height - 80)).toBeLessThan(0.5)
  })

  // =========================================================================
  // K2: pdfToView roundtrip
  // =========================================================================
  it('K2: pdfToView round-trip with viewToPdf has error < 1e-9 for 4 rotations and offset CropBox', () => {
    const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270]
    const testPoints = [
      { u: 0, v: 0 },
      { u: 0.15, v: 0.35 },
      { u: 0.5, v: 0.5 },
      { u: 0.88, v: 0.12 },
      { u: 1, v: 1 },
    ]

    for (const rotation of rotations) {
      const view = {
        box: [50, 70, 450, 670] as [number, number, number, number],
        rotation,
      }

      for (const { u, v } of testPoints) {
        const pt = viewToPdf(view, u, v)
        const roundTrip = pdfToView(view, pt.x, pt.y)

        expect(Math.abs(roundTrip.u - u)).toBeLessThan(1e-9)
        expect(Math.abs(roundTrip.v - v)).toBeLessThan(1e-9)
      }
    }
  })

  // =========================================================================
  // K3: applyImageEdits remove
  // =========================================================================
  it('K3: applyImageEdits removes image 1, leaving exactly 1 paintImageXObject and preserving text intact', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Preserved Text Content', { x: 50, y: 350, size: 14, font })

    const png = await doc.embedPng(TINY_PNG)
    page.drawImage(png, { x: 50, y: 100, width: 100, height: 50 })
    page.drawImage(png, { x: 200, y: 100, width: 80, height: 80 })

    const baseBytes = await doc.save()
    const docLoaded = await PDFDocument.load(baseBytes)

    const probed = probePageImages(docLoaded, 0)
    expect(probed.images.length).toBe(2)

    const removeEdit = {
      resourceName: probed.images[0].resourceName,
      occurrence: probed.images[0].occurrence,
      remove: true,
    }

    const { applied, notFound } = applyImageEdits(docLoaded, 0, [removeEdit])
    expect(applied).toBe(1)
    expect(notFound).toBe(0)

    const savedBytes = await docLoaded.save()
    const pdfjsDoc = await pdfjsLib.getDocument({ data: savedBytes.slice() }).promise
    const pdfjsPage = await pdfjsDoc.getPage(1)

    // Check operator list in pdf.js
    const opList = await pdfjsPage.getOperatorList()
    const imageOps = opList.fnArray.filter(
      (fn) => fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintInlineImageXObject,
    )
    expect(imageOps.length).toBe(1)

    // Check text content intact
    const textContent = await pdfjsPage.getTextContent()
    const textJoined = textContent.items.map((i: unknown) => (i as { str: string }).str).join(' ')
    expect(textJoined).toContain('Preserved Text Content')
  })

  // =========================================================================
  // K4: move image
  // =========================================================================
  it('K4: moves image 1 to (200, 400, 100, 50), probe on export shows new bbox ±0.5pt and image 2 unchanged', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const png = await doc.embedPng(TINY_PNG)

    page.drawImage(png, { x: 50, y: 600, width: 100, height: 50 })
    page.drawImage(png, { x: 300, y: 100, width: 80, height: 80 })

    const baseBytes = await doc.save()
    const docLoaded = await PDFDocument.load(baseBytes)

    const probedBefore = probePageImages(docLoaded, 0)
    expect(probedBefore.images.length).toBe(2)

    const moveEdit = {
      resourceName: probedBefore.images[0].resourceName,
      occurrence: probedBefore.images[0].occurrence,
      newBbox: { x: 200, y: 400, width: 100, height: 50 },
    }

    const { applied, notFound } = applyImageEdits(docLoaded, 0, [moveEdit])
    expect(applied).toBe(1)
    expect(notFound).toBe(0)

    const savedBytes = await docLoaded.save()
    const reloaded = await PDFDocument.load(savedBytes)
    const probedAfter = probePageImages(reloaded, 0)

    expect(probedAfter.images.length).toBe(2)

    const movedImg = probedAfter.images.find(
      (i) => i.resourceName === probedBefore.images[0].resourceName && i.occurrence === probedBefore.images[0].occurrence,
    )!
    expect(Math.abs(movedImg.bbox.x - 200)).toBeLessThan(0.5)
    expect(Math.abs(movedImg.bbox.y - 400)).toBeLessThan(0.5)
    expect(Math.abs(movedImg.bbox.width - 100)).toBeLessThan(0.5)
    expect(Math.abs(movedImg.bbox.height - 50)).toBeLessThan(0.5)

    const unchangedImg = probedAfter.images.find(
      (i) => i.resourceName === probedBefore.images[1].resourceName && i.occurrence === probedBefore.images[1].occurrence,
    )!
    expect(Math.abs(unchangedImg.bbox.x - 300)).toBeLessThan(0.5)
    expect(Math.abs(unchangedImg.bbox.y - 100)).toBeLessThan(0.5)
    expect(Math.abs(unchangedImg.bbox.width - 80)).toBeLessThan(0.5)
    expect(Math.abs(unchangedImg.bbox.height - 80)).toBeLessThan(0.5)
  })

  // =========================================================================
  // K5: resize on rotated page
  // =========================================================================
  it('K5: scales image 2x on page with /Rotate 90 via buildEditedPdfWithReport, exported bbox matches viewToPdf ±0.5pt', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 600])
    page.setRotation(degrees(90))
    const png = await doc.embedPng(TINY_PNG)

    // Draw an image at (50, 100, 100, 50)
    page.drawImage(png, { x: 50, y: 100, width: 100, height: 50 })
    const baseBytes = new Uint8Array(await doc.save())

    const docBefore = await PDFDocument.load(baseBytes)
    const probedBefore = probePageImages(docBefore, 0)
    expect(probedBefore.images.length).toBe(1)
    const origInfo = probedBefore.images[0]

    const pageView = getPageView(docBefore.getPage(0))
    // Map corners of origInfo.bbox to view space
    const c1 = pdfToView(pageView, origInfo.bbox.x, origInfo.bbox.y)
    const c2 = pdfToView(pageView, origInfo.bbox.x + origInfo.bbox.width, origInfo.bbox.y + origInfo.bbox.height)
    const origViewX = Math.min(c1.u, c2.u)
    const origViewY = Math.min(c1.v, c2.v)
    const origViewW = Math.abs(c2.u - c1.u)
    const origViewH = Math.abs(c2.v - c1.v)

    // Double the size in view space
    const targetAnn: Annotation = {
      id: 'ann-img-k5',
      page: 1,
      type: 'image',
      x: origViewX,
      y: origViewY,
      width: origViewW * 2,
      height: origViewH * 2,
      color: '#000000',
      opacity: 1,
      imageDataUrl: 'data:image/png;base64,mock',
      sourceImage: {
        resourceName: origInfo.resourceName,
        occurrence: origInfo.occurrence,
        originalRect: {
          x: origViewX,
          y: origViewY,
          width: origViewW,
          height: origViewH,
        },
      },
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [targetAnn])
    const docExported = await PDFDocument.load(outBytes)
    const probedExported = probePageImages(docExported, 0)
    expect(probedExported.images.length).toBe(1)
    const exportedBbox = probedExported.images[0].bbox

    // Expected bbox from viewToPdf 4 corners of targetAnn
    const p1 = viewToPdf(pageView, targetAnn.x, targetAnn.y)
    const p2 = viewToPdf(pageView, targetAnn.x + targetAnn.width, targetAnn.y)
    const p3 = viewToPdf(pageView, targetAnn.x + targetAnn.width, targetAnn.y + targetAnn.height)
    const p4 = viewToPdf(pageView, targetAnn.x, targetAnn.y + targetAnn.height)
    const expMinX = Math.min(p1.x, p2.x, p3.x, p4.x)
    const expMaxX = Math.max(p1.x, p2.x, p3.x, p4.x)
    const expMinY = Math.min(p1.y, p2.y, p3.y, p4.y)
    const expMaxY = Math.max(p1.y, p2.y, p3.y, p4.y)

    expect(Math.abs(exportedBbox.x - expMinX)).toBeLessThan(0.5)
    expect(Math.abs(exportedBbox.y - expMinY)).toBeLessThan(0.5)
    expect(Math.abs(exportedBbox.width - (expMaxX - expMinX))).toBeLessThan(0.5)
    expect(Math.abs(exportedBbox.height - (expMaxY - expMinY))).toBeLessThan(0.5)
  })

  // =========================================================================
  // K6: unchanged stream bytes
  // =========================================================================
  it('K6: annotation sourceImage with unchanged bounding box produces byte-identical page content stream', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const png = await doc.embedPng(TINY_PNG)
    page.drawImage(png, { x: 120, y: 450, width: 140, height: 70 })
    const baseBytes = new Uint8Array(await doc.save())

    const docBefore = await PDFDocument.load(baseBytes)
    const origStreamBytes = readPageContent(docBefore, 0)

    const pageView = getPageView(docBefore.getPage(0))
    const origInfo = probePageImages(docBefore, 0).images[0]
    const c1 = pdfToView(pageView, origInfo.bbox.x, origInfo.bbox.y)
    const c2 = pdfToView(pageView, origInfo.bbox.x + origInfo.bbox.width, origInfo.bbox.y + origInfo.bbox.height)
    const viewX = Math.min(c1.u, c2.u)
    const viewY = Math.min(c1.v, c2.v)
    const viewW = Math.abs(c2.u - c1.u)
    const viewH = Math.abs(c2.v - c1.v)

    const unchangedAnn: Annotation = {
      id: 'ann-img-k6',
      page: 1,
      type: 'image',
      x: viewX,
      y: viewY,
      width: viewW,
      height: viewH,
      color: '#000000',
      opacity: 1,
      imageDataUrl: 'data:image/png;base64,mock',
      sourceImage: {
        resourceName: origInfo.resourceName,
        occurrence: origInfo.occurrence,
        originalRect: { x: viewX, y: viewY, width: viewW, height: viewH },
      },
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [unchangedAnn])
    const docAfter = await PDFDocument.load(outBytes)
    const afterStreamBytes = readPageContent(docAfter, 0)

    expect(afterStreamBytes).toEqual(origStreamBytes)
  })

  // =========================================================================
  // K7: image-not-found warning
  // =========================================================================
  it('K7: wrong occurrence reports image-not-found warning, file still exports cleanly', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const png = await doc.embedPng(TINY_PNG)
    page.drawImage(png, { x: 50, y: 100, width: 80, height: 80 })
    const baseBytes = new Uint8Array(await doc.save())

    const notFoundAnn: Annotation = {
      id: 'ann-img-k7',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      color: '#000000',
      opacity: 1,
      imageDataUrl: 'data:image/png;base64,mock',
      sourceImage: {
        resourceName: 'Im1',
        occurrence: 99, // non-existent occurrence
        originalRect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      },
    }

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, [notFoundAnn])

    expect(report.warnings.some((w) => w.reason === 'image-not-found' && w.page === 1)).toBe(true)

    const warnMsg = formatRemainingTextWarning(report.warnings)
    expect(warnMsg).toContain('không tìm thấy ảnh gốc để sửa, ảnh có thể vẫn ở vị trí cũ')

    // Document is still exported and valid
    const loaded = await PDFDocument.load(outBytes)
    expect(loaded.getPageCount()).toBe(1)
  })

  // =========================================================================
  // K8: PdfCanvas interaction (jsdom)
  // =========================================================================
  it('K8: PdfCanvas with pageImages: clicking editable region creates annotation with sourceImage; disabled region cannot be edited', () => {
    const mockPdf = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 400 }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
        getTextContent: () => Promise.resolve({ items: [] }),
      }),
    } as unknown as pdfjsLib.PDFDocumentProxy

    const pageImages: PageImageRegion[] = [
      {
        id: 'img-1-Im1-0',
        page: 1,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.25,
        resourceName: 'Im1',
        occurrence: 0,
        editable: true,
      },
      {
        id: 'img-1-Im2-0',
        page: 1,
        x: 0.5,
        y: 0.6,
        width: 0.2,
        height: 0.2,
        resourceName: 'Im2',
        occurrence: 0,
        editable: false,
      },
    ]

    const onAdd = vi.fn()
    const onSelect = vi.fn()

    act(() => {
      root.render(
        <PdfCanvas
          pdf={mockPdf}
          pageNumber={1}
          zoom={1}
          annotations={[]}
          tool="select"
          color="#000000"
          onAdd={onAdd}
          onUpdate={vi.fn()}
          selectedId={null}
          onSelect={onSelect}
          textRegions={[]}
          onTextRegions={vi.fn()}
          onEditRegion={vi.fn()}
          onEditAnnotation={vi.fn()}
          pageImages={pageImages}
        />,
      )
    })

    const buttons = container.querySelectorAll<HTMLButtonElement>('button.page-image-region')
    expect(buttons.length).toBe(2)

    const editableBtn = Array.from(buttons).find((b) => !b.classList.contains('disabled'))!
    const disabledBtn = Array.from(buttons).find((b) => b.classList.contains('disabled'))!

    expect(editableBtn).toBeDefined()
    expect(editableBtn.title).toBe('Ảnh trong PDF')
    expect(editableBtn.getAttribute('aria-disabled')).toBeNull()

    expect(disabledBtn).toBeDefined()
    expect(disabledBtn.title).toBe('Ảnh này chưa hỗ trợ sửa')
    expect(disabledBtn.getAttribute('aria-disabled')).toBe('true')

    // Click disabled -> does NOT invoke onAdd
    act(() => {
      disabledBtn.click()
    })
    expect(onAdd).not.toHaveBeenCalled()

    // Click editable -> invokes onAdd with sourceImage
    act(() => {
      editableBtn.click()
    })
    expect(onAdd).toHaveBeenCalledTimes(1)
    const createdAnn = onAdd.mock.calls[0][0] as Annotation
    expect(createdAnn.type).toBe('image')
    expect(createdAnn.sourceImage).toBeDefined()
    expect(createdAnn.sourceImage?.resourceName).toBe('Im1')
    expect(createdAnn.sourceImage?.occurrence).toBe(0)
    expect(createdAnn.sourceImage?.originalRect).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.25,
    })
  })

  // =========================================================================
  // K9: canRotatePage
  // =========================================================================
  it('K9: canRotatePage returns false when page has an annotation with sourceImage', () => {
    const annWithSourceImage: Annotation = {
      id: 'ann-source-img',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      color: '#000',
      opacity: 1,
      sourceImage: {
        resourceName: 'Im1',
        occurrence: 0,
        originalRect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      },
    }

    const regularImageAnn: Annotation = {
      id: 'ann-reg-img',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      color: '#000',
      opacity: 1,
      imageDataUrl: 'data:image/png;base64,mock',
    }

    // Page 1 with sourceImage cannot be rotated
    expect(canRotatePage([annWithSourceImage], 1)).toBe(false)
    // Page 2 without annotations on page 2 can be rotated
    expect(canRotatePage([annWithSourceImage], 2)).toBe(true)
    // Regular image annotation allows rotation
    expect(canRotatePage([regularImageAnn], 1)).toBe(true)
  })
})
