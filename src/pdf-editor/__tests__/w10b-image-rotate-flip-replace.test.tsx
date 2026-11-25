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
import { PDFDocument, degrees } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import type { Annotation } from '../../types'
import {
  imagePlacementMatrix,
  getPageView,
  viewToPdf,
  buildEditedPdfWithReport,
} from '../index'
import { PropertiesPanel } from '../PropertiesPanel'

// 1x1 transparent PNG bytes
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

const TINY_PNG_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const TINY_PNG_2_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACanAg4P3mDkAAAAAElFTkSuQmCC'

describe('W-10b: Image Rotate, Flip and Replace Suite', () => {
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
  // K1: imagePlacementMatrix on standard page
  // =========================================================================
  it('K1: imagePlacementMatrix matches expected values for no-rot, 90-rot, and flipH', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const view = getPageView(page)

    const baseAnn: Annotation = {
      id: 'img-1',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
      imageDataUrl: TINY_PNG_DATAURL,
    }

    // (a) No rotation / flip
    const m0 = imagePlacementMatrix(baseAnn, view)
    expect(m0[0]).toBeCloseTo(120, 5)
    expect(m0[1]).toBeCloseTo(0, 5)
    expect(m0[2]).toBeCloseTo(0, 5)
    expect(m0[3]).toBeCloseTo(40, 5)
    expect(m0[4]).toBeCloseTo(60, 5)
    expect(m0[5]).toBeCloseTo(320, 5)

    // (b) Rotated 90 degrees
    const m90 = imagePlacementMatrix({ ...baseAnn, imageRotation: 90 }, view)
    expect(m90[0]).toBeCloseTo(0, 5)
    expect(m90[1]).toBeCloseTo(-40, 5)
    expect(m90[2]).toBeCloseTo(120, 5)
    expect(m90[3]).toBeCloseTo(0, 5)
    expect(m90[4]).toBeCloseTo(60, 5)
    expect(m90[5]).toBeCloseTo(360, 5)

    // Verify det > 0
    const det90 = m90[0] * m90[3] - m90[1] * m90[2]
    expect(det90).toBeGreaterThan(0)

    // (c) Horizontal flip
    const mFlipH = imagePlacementMatrix({ ...baseAnn, flipH: true }, view)
    expect(mFlipH[0]).toBeCloseTo(-120, 5)
    expect(mFlipH[1]).toBeCloseTo(0, 5)
    expect(mFlipH[2]).toBeCloseTo(0, 5)
    expect(mFlipH[3]).toBeCloseTo(40, 5)
    expect(mFlipH[4]).toBeCloseTo(180, 5)
    expect(mFlipH[5]).toBeCloseTo(320, 5)
    expect(mFlipH[0]).toBeLessThan(0)
  })

  // =========================================================================
  // K2: imagePlacementMatrix on rotated page and CropBox offset
  // =========================================================================
  it('K2: imagePlacementMatrix correctly maps corners on Rotate 90 and CropBox offset', async () => {
    // Page with Rotate 90
    const doc = await PDFDocument.create()
    const pageRot = doc.addPage([600, 400])
    pageRot.setRotation(degrees(90))
    const viewRot = getPageView(pageRot)

    const ann: Annotation = {
      id: 'img-2',
      page: 1,
      type: 'image',
      x: 0.15,
      y: 0.25,
      width: 0.3,
      height: 0.2,
      color: '#000000',
      opacity: 1,
      imageRotation: 180,
      flipH: true,
      imageDataUrl: TINY_PNG_DATAURL,
    }

    const mRot = imagePlacementMatrix(ann, viewRot)
    // Upright dimensions in view space:
    const wImg = ann.width
    const hImg = ann.height
    const uc = ann.x + ann.width / 2
    const vc = ann.y + ann.height / 2

    // Local upright corners:
    const xi0 = -wImg / 2, eta0 = hImg / 2
    const xi1 = wImg / 2, eta1 = hImg / 2
    const xi2 = -wImg / 2, eta2 = -hImg / 2

    // flipH=true:
    const flip = (xi: number, eta: number) => ({ xi: -xi, eta })
    // rot=180:
    const rot = (xi: number, eta: number) => ({ du: -xi, dv: -eta })

    const p0View = rot(flip(xi0, eta0).xi, flip(xi0, eta0).eta)
    const p1View = rot(flip(xi1, eta1).xi, flip(xi1, eta1).eta)
    const p2View = rot(flip(xi2, eta2).xi, flip(xi2, eta2).eta)

    const p0Pdf = viewToPdf(viewRot, uc + p0View.du, vc + p0View.dv)
    const p1Pdf = viewToPdf(viewRot, uc + p1View.du, vc + p1View.dv)
    const p2Pdf = viewToPdf(viewRot, uc + p2View.du, vc + p2View.dv)

    // m = [P1.x - P0.x, P1.y - P0.y, P2.x - P0.x, P2.y - P0.y, P0.x, P0.y]
    expect(mRot[4]).toBeCloseTo(p0Pdf.x, 5)
    expect(mRot[5]).toBeCloseTo(p0Pdf.y, 5)
    expect(mRot[0]).toBeCloseTo(p1Pdf.x - p0Pdf.x, 5)
    expect(mRot[1]).toBeCloseTo(p1Pdf.y - p0Pdf.y, 5)
    expect(mRot[2]).toBeCloseTo(p2Pdf.x - p0Pdf.x, 5)
    expect(mRot[3]).toBeCloseTo(p2Pdf.y - p0Pdf.y, 5)

    // Page with CropBox offset [100, 100, 700, 500]
    const docCrop = await PDFDocument.create()
    const pageCrop = docCrop.addPage([800, 600])
    pageCrop.setCropBox(100, 100, 600, 400)
    const viewCrop = getPageView(pageCrop)

    const mCrop = imagePlacementMatrix(ann, viewCrop)
    const p0CropPdf = viewToPdf(viewCrop, uc + p0View.du, vc + p0View.dv)
    expect(mCrop[4]).toBeCloseTo(p0CropPdf.x, 5)
    expect(mCrop[5]).toBeCloseTo(p0CropPdf.y, 5)
  })

  // =========================================================================
  // K3: Inserted image rotated 90° exported to pdf.js
  // =========================================================================
  it('K3: Inserted image rotated 90° exports with matching CTM in pdf.js operator list', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const baseBytes = await doc.save()

    const annRot: Annotation = {
      id: 'ins-1',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      imageRotation: 90,
      opacity: 0.8,
      imageDataUrl: TINY_PNG_DATAURL,
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [annRot])

    // Load with pdfjs using a copy of the buffer so outBytes is preserved
    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    // Look for paintImageXObject opcode
    const paintImgIdx = opList.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)
    expect(paintImgIdx).toBeGreaterThan(0)

    // Find preceding transform opcode
    let transformMatrix: number[] | null = null
    for (let i = paintImgIdx - 1; i >= 0; i--) {
      if (opList.fnArray[i] === pdfjsLib.OPS.transform) {
        transformMatrix = opList.argsArray[i]
        break
      }
    }

    expect(transformMatrix).not.toBeNull()
    const reloadDoc = await PDFDocument.load(outBytes)
    const v = getPageView(reloadDoc.getPage(0))
    const expectedM = imagePlacementMatrix(annRot, v)

    for (let i = 0; i < 6; i++) {
      expect(transformMatrix![i]).toBeCloseTo(expectedM[i], 1)
    }

    // Also verify unrotated image exports cleanly
    const annUnrot: Annotation = {
      ...annRot,
      id: 'ins-unrot',
      imageRotation: 0,
    }
    const { bytes: outUnrotBytes } = await buildEditedPdfWithReport(baseBytes, [annUnrot])
    const pdfjsUnrot = await pdfjsLib.getDocument({ data: new Uint8Array(outUnrotBytes) }).promise
    const pUnrot = await pdfjsUnrot.getPage(1)
    const opListUnrot = await pUnrot.getOperatorList()
    expect(opListUnrot.fnArray.includes(pdfjsLib.OPS.paintImageXObject)).toBe(true)
  })

  // =========================================================================
  // K4: Existing image rotated 90° and flipV exported
  // =========================================================================
  it('K4: Existing image rotated 90° and flipV exports with expected CTM and negative d', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const png = await doc.embedPng(TINY_PNG)
    // Draw existing image at (60, 320, 120, 40)
    page.drawImage(png, { x: 60, y: 320, width: 120, height: 40 })
    const baseBytes = await doc.save()

    const annExistRot: Annotation = {
      id: 'exist-1',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
      imageRotation: 90,
      sourceImage: {
        resourceName: 'Im0', // will match whatever name pdf-lib generated
        occurrence: 0,
        originalRect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      },
    }

    // First find actual resourceName
    const checkDoc = await PDFDocument.load(baseBytes)
    const { probePageImages } = await import('../engine/imageProbe')
    const probed = probePageImages(checkDoc, 0)
    expect(probed.images.length).toBe(1)
    annExistRot.sourceImage!.resourceName = probed.images[0].resourceName

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [annExistRot])
    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    const paintIdx = opList.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)
    expect(paintIdx).toBeGreaterThan(0)

    // Calculate effective cumulative CTM up to paintImageXObject
    const multMatrix = (
      m1: [number, number, number, number, number, number],
      m2: [number, number, number, number, number, number],
    ): [number, number, number, number, number, number] => [
      m1[0] * m2[0] + m1[1] * m2[2],
      m1[0] * m2[1] + m1[1] * m2[3],
      m1[2] * m2[0] + m1[3] * m2[2],
      m1[2] * m2[1] + m1[3] * m2[3],
      m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
      m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
    ]

    const stack: [number, number, number, number, number, number][] = []
    let currentCtm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
    for (let i = 0; i < paintIdx; i++) {
      const fn = opList.fnArray[i]
      if (fn === pdfjsLib.OPS.save) {
        stack.push([...currentCtm])
      } else if (fn === pdfjsLib.OPS.restore) {
        if (stack.length > 0) currentCtm = stack.pop()!
      } else if (fn === pdfjsLib.OPS.transform) {
        currentCtm = multMatrix(opList.argsArray[i] as [number, number, number, number, number, number], currentCtm)
      }
    }

    const v = getPageView(checkDoc.getPage(0))
    const expectedM = imagePlacementMatrix(annExistRot, v)
    for (let i = 0; i < 6; i++) {
      expect(currentCtm[i]).toBeCloseTo(expectedM[i], 1)
    }

    // Flip vertical: d of effective CTM should be < 0
    const annFlipV: Annotation = {
      ...annExistRot,
      id: 'exist-flipv',
      imageRotation: 0,
      flipV: true,
    }
    const { bytes: outFlipVBytes } = await buildEditedPdfWithReport(baseBytes, [annFlipV])
    const pdfjsFlipV = await pdfjsLib.getDocument({ data: new Uint8Array(outFlipVBytes) }).promise
    const pFlipV = await pdfjsFlipV.getPage(1)
    const opListFlipV = await pFlipV.getOperatorList()
    const paintIdxV = opListFlipV.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)

    const stackV: [number, number, number, number, number, number][] = []
    let currentCtmV: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
    for (let i = 0; i < paintIdxV; i++) {
      const fn = opListFlipV.fnArray[i]
      if (fn === pdfjsLib.OPS.save) {
        stackV.push([...currentCtmV])
      } else if (fn === pdfjsLib.OPS.restore) {
        if (stackV.length > 0) currentCtmV = stackV.pop()!
      } else if (fn === pdfjsLib.OPS.transform) {
        currentCtmV = multMatrix(opListFlipV.argsArray[i] as [number, number, number, number, number, number], currentCtmV)
      }
    }

    expect(currentCtmV[3]).toBeLessThan(0)
  })

  // =========================================================================
  // K5: Replace existing image used twice on page
  // =========================================================================
  it('K5: Replace existing image used twice on page modifies only 2nd occurrence', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const png = await doc.embedPng(TINY_PNG)
    // Draw same image twice
    page.drawImage(png, { x: 50, y: 200, width: 80, height: 60 })
    page.drawImage(png, { x: 250, y: 200, width: 80, height: 60 })
    const baseBytes = await doc.save()

    const checkDoc = await PDFDocument.load(baseBytes)
    const { probePageImages } = await import('../engine/imageProbe')
    const probed = probePageImages(checkDoc, 0)
    expect(probed.images.length).toBe(2)
    const resName = probed.images[0].resourceName

    // Replace 2nd occurrence (occurrence = 1)
    const annReplace: Annotation = {
      id: 'replace-occ-1',
      page: 1,
      type: 'image',
      x: 0.4,
      y: 0.4,
      width: 0.3,
      height: 0.2,
      color: '#000000',
      opacity: 1,
      replacementDataUrl: TINY_PNG_2_DATAURL,
      sourceImage: {
        resourceName: resName,
        occurrence: 1,
        originalRect: { x: 250 / 600, y: (400 - 260) / 400, width: 80 / 600, height: 60 / 400 },
      },
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [annReplace])
    const checkDoc2 = await PDFDocument.load(outBytes)
    const { readPageContent } = await import('../engine/pageContent')
    const { tokenizeContent } = await import('../engine/contentTokenizer')
    const bytes = readPageContent(checkDoc2, 0)
    const ops = tokenizeContent(bytes)
    const doOps = ops.filter(o => o.operator === 'Do')
    expect(doOps.length).toBe(2)
    // 1st occurrence keeps old resource name
    const op1 = doOps[0].operands[0]
    expect(op1.type === 'name' ? op1.value.replace(/^\//, '') : '').toBe(resName)
    // 2nd occurrence has new resource name
    const op2 = doOps[1].operands[0]
    expect(op2.type === 'name' ? op2.value.replace(/^\//, '') : '').not.toBe(resName)
  })

  // =========================================================================
  // K6: Replace inserted image recalculates height and keeps (x, y)
  // =========================================================================
  it('K6: Replace inserted image updates imageDataUrl and recalculates height preserving aspect', async () => {
    const onUpdateAnnotation = vi.fn()
    const pageSizePt = { width: 600, height: 400 }

    const initialAnn: Annotation = {
      id: 'ins-test',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.2,
      width: 0.3, // 180 pt
      height: 0.2, // 80 pt
      color: '#000000',
      opacity: 1,
      imageDataUrl: TINY_PNG_DATAURL,
    }

    act(() => {
      root.render(
        <PropertiesPanel
          selectedAnnotation={initialAnn}
          pageSizePt={pageSizePt}
          tool="select"
          textStyle={{ fontFamily: 'Helvetica', fontSize: 16, color: '#000000' }}
          onTextStyleChange={vi.fn()}
          onUpdateAnnotation={onUpdateAnnotation}
          aspectLocked={false}
          onToggleAspectLock={vi.fn()}
        />,
      )
    })

    // Mock Image object to return naturalWidth = 200, naturalHeight = 100 (aspect 2:1)
    const origImage = globalThis.Image
    class MockImage {
      naturalWidth = 200
      naturalHeight = 100
      onload: (() => void) | null = null
      set src(_val: string) {
        setTimeout(() => this.onload?.(), 0)
      }
    }
    // @ts-expect-error mock image
    globalThis.Image = MockImage

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()

    const mockFile = new File(['dummy'], 'test.png', { type: 'image/png' })
    // Simulate change
    await act(async () => {
      Object.defineProperty(fileInput, 'files', {
        value: [mockFile],
      })
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(onUpdateAnnotation).toHaveBeenCalled()
    const [updatedAnn, kind] = onUpdateAnnotation.mock.calls[0]
    expect(kind).toBe('resize')
    expect(updatedAnn.x).toBe(0.1)
    expect(updatedAnn.y).toBe(0.2)
    expect(updatedAnn.width).toBe(0.3)
    // Width = 0.3 * 600 = 180 pt. Aspect = 200/100 = 2.
    // New height in pt = 180 / 2 = 90 pt.
    // New height in view = 90 / 400 = 0.225.
    expect(updatedAnn.height).toBeCloseTo(0.225, 3)

    globalThis.Image = origImage
  })

  // =========================================================================
  // K7: PropertiesPanel UI buttons and rotate click (jsdom)
  // =========================================================================
  it('K7: PropertiesPanel renders 5 image buttons and clicking Rotate Right updates rotation and swaps dimensions', () => {
    const onUpdateAnnotation = vi.fn()
    const pageSizePt = { width: 600, height: 400 }

    const sourceAnn: Annotation = {
      id: 'img-source',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2, // 120 pt
      height: 0.1, // 40 pt
      color: '#000000',
      opacity: 1,
      sourceImage: {
        resourceName: 'Im1',
        occurrence: 0,
        originalRect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
      },
    }

    act(() => {
      root.render(
        <PropertiesPanel
          selectedAnnotation={sourceAnn}
          pageSizePt={pageSizePt}
          tool="select"
          textStyle={{ fontFamily: 'Helvetica', fontSize: 16, color: '#000000' }}
          onTextStyleChange={vi.fn()}
          onUpdateAnnotation={onUpdateAnnotation}
          aspectLocked={false}
          onToggleAspectLock={vi.fn()}
        />,
      )
    })

    // Verify 5 buttons exist
    const rotLeftBtn = container.querySelector('button[aria-label="Xoay trái 90°"]')
    const rotRightBtn = container.querySelector('button[aria-label="Xoay phải 90°"]')
    const flipHBtn = container.querySelector('button[aria-label="Lật ngang"]')
    const flipVBtn = container.querySelector('button[aria-label="Lật dọc"]')
    const replaceBtn = container.querySelector('button[aria-label="Thay ảnh…"]')

    expect(rotLeftBtn).not.toBeNull()
    expect(rotRightBtn).not.toBeNull()
    expect(flipHBtn).not.toBeNull()
    expect(flipVBtn).not.toBeNull()
    expect(replaceBtn).not.toBeNull()

    // Opacity slider should be hidden for sourceImage
    const opacitySlider = container.querySelector('input#prop-opacity')
    expect(opacitySlider).toBeNull()

    // Click Rotate Right
    act(() => {
      ;(rotRightBtn as HTMLButtonElement).click()
    })

    expect(onUpdateAnnotation).toHaveBeenCalledTimes(1)
    const [updatedAnn, kind] = onUpdateAnnotation.mock.calls[0]
    expect(kind).toBe('resize')
    expect(updatedAnn.imageRotation).toBe(90)
    // Swapped width & height:
    // old wPt = 120, old hPt = 40. Center was (0.1 + 0.1)*600 = 120 pt, (0.1 + 0.05)*400 = 60 pt.
    // new wPt = 40 => new w = 40 / 600 = 1/15 ≈ 0.0667.
    // new hPt = 120 => new h = 120 / 400 = 0.3.
    expect(updatedAnn.width * pageSizePt.width).toBeCloseTo(40, 5)
    expect(updatedAnn.height * pageSizePt.height).toBeCloseTo(120, 5)
  })
})
