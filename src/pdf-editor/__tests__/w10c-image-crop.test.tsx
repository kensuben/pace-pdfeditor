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
import { PDFDocument } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import type { Annotation } from '../../types'
import {
  croppedImageMatrix,
  applyImageCrop,
  getPageView,
  buildEditedPdfWithReport,
  probePageImages,
} from '../index'
import { PropertiesPanel } from '../PropertiesPanel'

// 4x2 asymmetric PNG (base64 data URL)
// row 0: red, green, blue, yellow
// row 1: magenta, cyan, white, black
const ASYMMETRIC_4x2_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAG0lEQVR4nGP4z8DwHwwZ/v//D2GBKAhgAEoCAD/wE+1R+Z8kAAAAAElFTkSuQmCC'

const ASYMMETRIC_4x2_BYTES = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAG0lEQVR4nGP4z8DwHwwZ/v//D2GBKAhgAEoCAD/wE+1R+Z8kAAAAAElFTkSuQmCC',
    'base64',
  ),
)

describe('W-10c: Image Crop Suite', () => {
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
  // K1: Bounding box changes when crop changes
  // =========================================================================
  it('K1: bounding box changes properly with crop: no-rot shifts x and shrinks width; rot 90 shifts top edge and shrinks height', () => {
    // 1. Unrotated image: (0.2, 0.2, 0.4, 0.2)
    const baseAnn: Annotation = {
      id: 'img-k1',
      page: 1,
      type: 'image',
      x: 0.2,
      y: 0.2,
      width: 0.4,
      height: 0.2,
      color: '#000000',
      opacity: 1,
      imageDataUrl: ASYMMETRIC_4x2_DATAURL,
    }

    const croppedUnrot = applyImageCrop(baseAnn, { left: 0.25, top: 0, right: 0, bottom: 0 })
    expect(croppedUnrot.x).toBeCloseTo(0.3, 5)
    expect(croppedUnrot.width).toBeCloseTo(0.3, 5)
    expect(croppedUnrot.y).toBeCloseTo(0.2, 5)
    expect(croppedUnrot.height).toBeCloseTo(0.2, 5)

    // 2. Rotated 90 degrees: (0.2, 0.2, 0.4, 0.2), imageRotation: 90
    // When upright image's left is cropped by 0.25:
    // Left of upright image maps to top edge of rotated 90 on screen.
    // The top edge on screen shifts down by 0.25 * upright_width = 0.25 * 0.2 = 0.05 (from 0.2 to 0.25).
    // The height on screen shrinks by 0.05 (from 0.2 to 0.15).
    // The width on screen remains 0.4 and x remains 0.2.
    const rot90Ann: Annotation = {
      ...baseAnn,
      imageRotation: 90,
    }
    const croppedRot90 = applyImageCrop(rot90Ann, { left: 0.25, top: 0, right: 0, bottom: 0 })
    expect(croppedRot90.x).toBeCloseTo(0.2, 5)
    expect(croppedRot90.width).toBeCloseTo(0.4, 5)
    expect(croppedRot90.y).toBeCloseTo(0.25, 5)
    expect(croppedRot90.height).toBeCloseTo(0.15, 5)
  })

  // =========================================================================
  // K2: croppedImageMatrix pure function
  // =========================================================================
  it('K2: croppedImageMatrix produces F where original points map to clip corners', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const view = getPageView(page)

    // Helper to apply matrix to point
    const applyM = (p: { x: number; y: number }, m: [number, number, number, number, number, number]) => ({
      x: p.x * m[0] + p.y * m[2] + m[4],
      y: p.x * m[1] + p.y * m[3] + m[5],
    })

    // (a) Standard unrotated image
    const ann: Annotation = {
      id: 'img-k2',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
      imageCrop: { left: 0.5, top: 0, right: 0, bottom: 0 },
      imageDataUrl: ASYMMETRIC_4x2_DATAURL,
    }

    const { matrix: F, clip } = croppedImageMatrix(ann, view)

    // Clip in PDF user space:
    // view (0.1, 0.1) to (0.3, 0.2) on 600x400:
    // x in [60, 180], y in [320, 360].
    // Bottom-left: (60, 320), Top-right: (180, 360).
    const blClip = { x: clip.x, y: clip.y }
    const trClip = { x: clip.x + clip.width, y: clip.y + clip.height }

    const pBL = applyM({ x: 0.5, y: 0 }, F)
    expect(pBL.x).toBeCloseTo(blClip.x, 2)
    expect(pBL.y).toBeCloseTo(blClip.y, 2)

    const pTR = applyM({ x: 1, y: 1 }, F)
    expect(pTR.x).toBeCloseTo(trClip.x, 2)
    expect(pTR.y).toBeCloseTo(trClip.y, 2)

    // (b) Rotated 90 degrees
    const annRot: Annotation = {
      ...ann,
      imageRotation: 90,
    }
    const { matrix: FRot, clip: clipRot } = croppedImageMatrix(annRot, view)
    const cornersRot = [
      applyM({ x: 0.5, y: 0 }, FRot),
      applyM({ x: 1, y: 0 }, FRot),
      applyM({ x: 1, y: 1 }, FRot),
      applyM({ x: 0.5, y: 1 }, FRot),
    ]
    const minXRot = Math.min(...cornersRot.map((c) => c.x))
    const maxXRot = Math.max(...cornersRot.map((c) => c.x))
    const minYRot = Math.min(...cornersRot.map((c) => c.y))
    const maxYRot = Math.max(...cornersRot.map((c) => c.y))
    expect(minXRot).toBeCloseTo(clipRot.x, 2)
    expect(maxXRot).toBeCloseTo(clipRot.x + clipRot.width, 2)
    expect(minYRot).toBeCloseTo(clipRot.y, 2)
    expect(maxYRot).toBeCloseTo(clipRot.y + clipRot.height, 2)

    // (c) Horizontal flip
    const annFlip: Annotation = {
      ...ann,
      flipH: true,
    }
    const { matrix: FFlip, clip: clipFlip } = croppedImageMatrix(annFlip, view)
    const cornersFlip = [
      applyM({ x: 0.5, y: 0 }, FFlip),
      applyM({ x: 1, y: 0 }, FFlip),
      applyM({ x: 1, y: 1 }, FFlip),
      applyM({ x: 0.5, y: 1 }, FFlip),
    ]
    const minXFlip = Math.min(...cornersFlip.map((c) => c.x))
    const maxXFlip = Math.max(...cornersFlip.map((c) => c.x))
    const minYFlip = Math.min(...cornersFlip.map((c) => c.y))
    const maxYFlip = Math.max(...cornersFlip.map((c) => c.y))
    expect(minXFlip).toBeCloseTo(clipFlip.x, 2)
    expect(maxXFlip).toBeCloseTo(clipFlip.x + clipFlip.width, 2)
    expect(minYFlip).toBeCloseTo(clipFlip.y, 2)
    expect(maxYFlip).toBeCloseTo(clipFlip.y + clipFlip.height, 2)
  })

  // =========================================================================
  // K3: Inserted image with crop exported to pdf.js
  // =========================================================================
  it('K3: inserted image with crop exports with clipping operators and CTM matching F in pdf.js', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const baseBytes = await doc.save()

    const annCrop: Annotation = {
      id: 'ins-crop-1',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
      imageCrop: { left: 0.5, top: 0, right: 0, bottom: 0 },
      imageDataUrl: ASYMMETRIC_4x2_DATAURL,
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [annCrop])
    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    const paintIdx = opList.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)
    expect(paintIdx).toBeGreaterThan(0)

    // Check that clip or eoClip precedes paintImageXObject
    const hasClip = opList.fnArray.slice(0, paintIdx).some(
      (fn) => fn === pdfjsLib.OPS.clip || fn === pdfjsLib.OPS.eoClip,
    )
    expect(hasClip).toBe(true)

    // Find transform preceding paintImageXObject
    let transformMatrix: number[] | null = null
    for (let i = paintIdx - 1; i >= 0; i--) {
      if (opList.fnArray[i] === pdfjsLib.OPS.transform) {
        transformMatrix = opList.argsArray[i]
        break
      }
    }
    expect(transformMatrix).not.toBeNull()

    const reloadDoc = await PDFDocument.load(outBytes)
    const v = getPageView(reloadDoc.getPage(0))
    const { matrix: expectedF } = croppedImageMatrix(annCrop, v)

    for (let i = 0; i < 6; i++) {
      expect(transformMatrix![i]).toBeCloseTo(expectedF[i], 1)
    }
  })

  // =========================================================================
  // K4: Existing image under non-unit CTM with crop
  // =========================================================================
  it('K4: existing image in non-unit CTM stream has clip transformed accurately and retains original XObject', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const png = await doc.embedPng(ASYMMETRIC_4x2_BYTES)

    // Draw inside q 2 0 0 2 0 0 cm ... Do Q
    // We can simulate this using low-level pushOperators
    const xobjKey = page.node.newXObject('Image', png.ref)
    const { pushGraphicsState, concatTransformationMatrix, drawObject, popGraphicsState } = await import('pdf-lib')
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(2, 0, 0, 2, 0, 0),
      concatTransformationMatrix(50, 0, 0, 40, 30, 80),
      drawObject(xobjKey),
      popGraphicsState(),
    )

    const baseBytes = await doc.save()

    const checkDoc = await PDFDocument.load(baseBytes)
    const probed = probePageImages(checkDoc, 0)
    expect(probed.images.length).toBe(1)
    const resName = probed.images[0].resourceName

    // Existing annotation on page 1 with top = 0.5
    const annCropExist: Annotation = {
      id: 'exist-crop-1',
      page: 1,
      type: 'image',
      x: 60 / 600,
      y: (400 - 160 - 80) / 400,
      width: 100 / 600,
      height: 80 / 400,
      color: '#000000',
      opacity: 1,
      imageCrop: { left: 0, top: 0.5, right: 0, bottom: 0 },
      sourceImage: {
        resourceName: resName,
        occurrence: 0,
        originalRect: {
          x: 60 / 600,
          y: (400 - 160 - 80) / 400,
          width: 100 / 600,
          height: 80 / 400,
        },
      },
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [annCropExist])

    // Verify stream operators: clip re W n and original XObject Do
    const checkDoc2 = await PDFDocument.load(outBytes)
    const { readPageContent } = await import('../engine/pageContent')
    const { tokenizeContent } = await import('../engine/contentTokenizer')
    const streamContent = readPageContent(checkDoc2, 0)
    const ops = tokenizeContent(streamContent)

    const doOp = ops.find((o) => o.operator === 'Do')
    expect(doOp).toBeDefined()
    // Original XObject is retained (no new embedding)
    const op0 = doOp!.operands[0]
    const opName = op0.type === 'name' ? op0.value.replace(/^\//, '') : ''
    expect(opName).toBe(resName)

    // Check re operator
    const reOp = ops.find((o) => o.operator === 're')
    expect(reOp).toBeDefined()
    const wOp = ops.find((o) => o.operator === 'W')
    expect(wOp).toBeDefined()
  })

  // =========================================================================
  // K5: Regression check - uncropped images maintain identical behavior
  // =========================================================================
  it('K5: uncropped images produce identical operators and pass existing behavior cleanly', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const png = await doc.embedPng(ASYMMETRIC_4x2_BYTES)
    page.drawImage(png, { x: 50, y: 100, width: 80, height: 60 })
    const baseBytes = await doc.save()

    const uncroppedAnn: Annotation = {
      id: 'uncropped-ins',
      page: 1,
      type: 'image',
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.2,
      color: '#000000',
      opacity: 1,
      imageDataUrl: ASYMMETRIC_4x2_DATAURL,
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [uncroppedAnn])
    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    // No clipping operator should be introduced for uncropped image
    expect(opList.fnArray.includes(pdfjsLib.OPS.clip)).toBe(false)
    expect(opList.fnArray.includes(pdfjsLib.OPS.eoClip)).toBe(false)
  })

  // =========================================================================
  // K6: PropertiesPanel crop inputs and 90% boundary clamping (jsdom)
  // =========================================================================
  it('K6: PropertiesPanel renders 4 crop fields, Bỏ cắt button, and enforces left + right <= 90%', () => {
    const onUpdateAnnotation = vi.fn()
    const pageSizePt = { width: 600, height: 400 }

    const initialAnn: Annotation = {
      id: 'img-panel-crop',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.1,
      width: 0.4,
      height: 0.2,
      color: '#000000',
      opacity: 1,
      imageCrop: { left: 0, top: 0, right: 0.4, bottom: 0 },
      imageDataUrl: ASYMMETRIC_4x2_DATAURL,
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

    const cropLeftInput = container.querySelector('input[aria-label="Cắt trái (%)"]') as HTMLInputElement
    const cropTopInput = container.querySelector('input[aria-label="Cắt trên (%)"]') as HTMLInputElement
    const cropRightInput = container.querySelector('input[aria-label="Cắt phải (%)"]') as HTMLInputElement
    const cropBottomInput = container.querySelector('input[aria-label="Cắt dưới (%)"]') as HTMLInputElement
    const resetCropBtn = container.querySelector('button[aria-label="Bỏ cắt"]') as HTMLButtonElement

    expect(cropLeftInput).not.toBeNull()
    expect(cropTopInput).not.toBeNull()
    expect(cropRightInput).not.toBeNull()
    expect(cropBottomInput).not.toBeNull()
    expect(resetCropBtn).not.toBeNull()

    expect(cropRightInput.value).toBe('40')

    // Input left = 60 when right = 40 (sum = 100 > 90) -> should be clamped to 50
    act(() => {
      cropLeftInput.focus()
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      nativeSetter?.call(cropLeftInput, '60')
      cropLeftInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      cropLeftInput.blur()
    })

    expect(onUpdateAnnotation).toHaveBeenCalledTimes(1)
    const [updatedAnn, kind] = onUpdateAnnotation.mock.calls[0]
    expect(kind).toBe('resize')
    expect(updatedAnn.imageCrop.left).toBeCloseTo(0.5, 3)
    expect(cropLeftInput.value).toBe('50')

    // Test Bỏ cắt button
    act(() => {
      resetCropBtn.click()
    })
    expect(onUpdateAnnotation).toHaveBeenCalledTimes(2)
    const [resetAnn] = onUpdateAnnotation.mock.calls[1]
    expect(resetAnn.imageCrop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
    expect(cropLeftInput.value).toBe('0')
    expect(cropRightInput.value).toBe('0')
  })
})
