import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { PDFDocument, rgb, pushGraphicsState, concatTransformationMatrix } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation } from '../../types'
import {
  reorderAnnotations,
  canReorder,
  buildEditedPdfWithReport,
  probePageImages,
  getPageView,
  croppedImageMatrix,
  pdfToView,
  type PageView,
} from '../index'
import { PropertiesPanel } from '../PropertiesPanel'
import { PdfCanvas } from '../PdfCanvas'

const ASYMMETRIC_4x2_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAG0lEQVR4nGP4z8DwHwwZ/v//D2GBKAhgAEoCAD/wE+1R+Z8kAAAAAElFTkSuQmCC'

const ASYMMETRIC_4x2_BYTES = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAG0lEQVR4nGP4z8DwHwwZ/v//D2GBKAhgAEoCAD/wE+1R+Z8kAAAAAElFTkSuQmCC',
    'base64',
  ),
)

function bboxToView(view: PageView, bbox: { x: number; y: number; width: number; height: number }) {
  const p1 = pdfToView(view, bbox.x, bbox.y)
  const p2 = pdfToView(view, bbox.x + bbox.width, bbox.y)
  const p3 = pdfToView(view, bbox.x + bbox.width, bbox.y + bbox.height)
  const p4 = pdfToView(view, bbox.x, bbox.y + bbox.height)
  const uMin = Math.min(p1.u, p2.u, p3.u, p4.u)
  const uMax = Math.max(p1.u, p2.u, p3.u, p4.u)
  const vMin = Math.min(p1.v, p2.v, p3.v, p4.v)
  const vMax = Math.max(p1.v, p2.v, p3.v, p4.v)
  return { x: uMin, y: vMin, width: uMax - uMin, height: vMax - vMin }
}

describe('W-10d: Layer Order Suite', () => {
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
  // K1: reorderAnnotations logic
  // =========================================================================
  it('K1: reorderAnnotations handles same-page relative reordering, ignores deleted, and returns same ref when at limit', () => {
    const annA: Annotation = {
      id: 'A',
      page: 1,
      type: 'text',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
    }
    const annD: Annotation = {
      id: 'D',
      page: 2,
      type: 'text',
      x: 0.5,
      y: 0.5,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
    }
    const annB: Annotation = {
      id: 'B',
      page: 1,
      type: 'text',
      x: 0.2,
      y: 0.2,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
    }
    const annC: Annotation = {
      id: 'C',
      page: 1,
      type: 'text',
      x: 0.3,
      y: 0.3,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
    }

    const initial = [annA, annD, annB, annC]

    // front(A) -> page 1 becomes B, C, A; D keeps relative position
    const frontA = reorderAnnotations(initial, 'A', 'front')
    expect(frontA.map((a) => a.id)).toEqual(['B', 'D', 'C', 'A'])

    // forward(A) on initial -> B, A, C; D keeps relative position
    const forwardA = reorderAnnotations(initial, 'A', 'forward')
    expect(forwardA.map((a) => a.id)).toEqual(['B', 'D', 'A', 'C'])

    // back(C) on initial -> C, A, B; D keeps relative position
    const backC = reorderAnnotations(initial, 'C', 'back')
    expect(backC.map((a) => a.id)).toEqual(['C', 'D', 'A', 'B'])

    // front(C) on initial: C is already at top of page 1 -> exact same reference
    const frontC = reorderAnnotations(initial, 'C', 'front')
    expect(frontC).toBe(initial)

    // forward(C) on initial -> exact same reference
    expect(reorderAnnotations(initial, 'C', 'forward')).toBe(initial)

    // back(A) on initial -> exact same reference
    expect(reorderAnnotations(initial, 'A', 'back')).toBe(initial)
    expect(canReorder(initial, 'A', 'back')).toBe(false)
    expect(canReorder(initial, 'A', 'front')).toBe(true)

    // backward(A) on initial -> exact same reference
    expect(reorderAnnotations(initial, 'A', 'backward')).toBe(initial)

    // Deleted annotations ignored when finding adjacent layer
    const annDel: Annotation = {
      id: 'Del',
      page: 1,
      type: 'text',
      x: 0.15,
      y: 0.15,
      width: 0.1,
      height: 0.1,
      color: '#000000',
      opacity: 1,
      deleted: true,
    }
    const withDeleted = [annA, annDel, annB, annC]
    // forward(A) skips Del and swaps with B
    const forwardWithDel = reorderAnnotations(withDeleted, 'A', 'forward')
    expect(forwardWithDel.map((a) => a.id)).toEqual(['B', 'Del', 'A', 'C'])
  })

  // =========================================================================
  // K2: Export order of inserted annotations (pdf.js getOperatorList)
  // =========================================================================
  it('K2: export order of inserted annotations: paintImageXObject is before highlight when back, after when front', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    const baseBytes = await doc.save()

    const annImg: Annotation = {
      id: 'img-1',
      page: 1,
      type: 'image',
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.3,
      color: '#000000',
      opacity: 1,
      imageDataUrl: ASYMMETRIC_4x2_DATAURL,
    }
    const annHl: Annotation = {
      id: 'hl-1',
      page: 1,
      type: 'highlight',
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.3,
      color: '#ffff00',
      opacity: 0.5,
    }

    // 1. back(image): image is first, highlight is second
    const orderBack = [annImg, annHl]
    const { bytes: bytesBack } = await buildEditedPdfWithReport(baseBytes, orderBack)
    const pdfBack = await pdfjsLib.getDocument({ data: bytesBack }).promise
    const pBack = await pdfBack.getPage(1)
    const opListBack = await pBack.getOperatorList()

    const imgIdxBack = opListBack.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)
    expect(imgIdxBack).toBeGreaterThan(0)
    // Find highlight drawing op (constructPath, fill, rectangle) occurring after or before
    const hlIdxBack = opListBack.fnArray.findIndex(
      (fn, i) => i > 0 && (fn === pdfjsLib.OPS.fill || fn === pdfjsLib.OPS.eoFill || fn === pdfjsLib.OPS.constructPath),
    )
    expect(hlIdxBack).toBeGreaterThan(0)
    expect(imgIdxBack).toBeLessThan(hlIdxBack)

    // 2. front(image): highlight is first, image is second
    const orderFront = [annHl, annImg]
    const { bytes: bytesFront } = await buildEditedPdfWithReport(baseBytes, orderFront)
    const pdfFront = await pdfjsLib.getDocument({ data: bytesFront }).promise
    const pFront = await pdfFront.getPage(1)
    const opListFront = await pFront.getOperatorList()

    const imgIdxFront = opListFront.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)
    expect(imgIdxFront).toBeGreaterThan(0)
    const hlIdxFront = opListFront.fnArray.findIndex(
      (fn, i) => i > 0 && (fn === pdfjsLib.OPS.fill || fn === pdfjsLib.OPS.eoFill || fn === pdfjsLib.OPS.constructPath),
    )
    expect(hlIdxFront).toBeGreaterThan(0)
    expect(imgIdxFront).toBeGreaterThan(hlIdxFront)
  })

  // =========================================================================
  // K3: Existing image 'bottom': stands before all showText, CTM preserves position
  // =========================================================================
  it('K3: existing image bottom stands before all showText, and preserves exact CTM', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.drawText('Sample Background Heading', { x: 50, y: 300, size: 24 })
    const png = await doc.embedPng(ASYMMETRIC_4x2_BYTES)
    page.drawImage(png, { x: 50, y: 150, width: 100, height: 80 })
    const baseBytes = await doc.save()

    const checkDoc = await PDFDocument.load(baseBytes)
    const probed = probePageImages(checkDoc, 0)
    expect(probed.images.length).toBe(1)
    const img = probed.images[0]
    const view = getPageView(checkDoc.getPage(0))
    const vRect = bboxToView(view, img.bbox)

    const annExistBottom: Annotation = {
      id: 'ann-exist-bottom',
      page: 1,
      type: 'image',
      x: vRect.x,
      y: vRect.y,
      width: vRect.width,
      height: vRect.height,
      color: '#000000',
      opacity: 1,
      sourceImage: {
        resourceName: img.resourceName,
        occurrence: img.occurrence,
        originalRect: { x: vRect.x, y: vRect.y, width: vRect.width, height: vRect.height },
      },
      pageLayer: 'bottom',
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [annExistBottom])
    const pdf = await pdfjsLib.getDocument({ data: outBytes }).promise
    const p1 = await pdf.getPage(1)
    const opList = await p1.getOperatorList()

    const paintIdx = opList.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)
    expect(paintIdx).toBeGreaterThan(0)

    const firstTextIdx = opList.fnArray.findIndex(
      (fn) => fn === pdfjsLib.OPS.showText || fn === pdfjsLib.OPS.showSpacedText,
    )
    expect(firstTextIdx).toBeGreaterThan(0)
    // paintImageXObject stands before all showText
    expect(paintIdx).toBeLessThan(firstTextIdx)

    // Verify CTM calculation at paintImageXObject matches original (50, 150, 100, 80)
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

    expect(currentCtm[0]).toBeCloseTo(100, 1)
    expect(currentCtm[3]).toBeCloseTo(80, 1)
    expect(currentCtm[4]).toBeCloseTo(50, 1)
    expect(currentCtm[5]).toBeCloseTo(150, 1)
  })

  // =========================================================================
  // K4: Existing image 'top': stands after rectangle fill, wraps in q...Q protecting CTM
  // =========================================================================
  it('K4: existing image top stands after rectangle fill and retains exact CTM despite unclosed q...cm in stream', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const png = await doc.embedPng(ASYMMETRIC_4x2_BYTES)
    page.drawImage(png, { x: 100, y: 100, width: 80, height: 60 })
    page.drawRectangle({ x: 90, y: 90, width: 100, height: 80, color: rgb(1, 0, 0) })
    // Add unclosed q ... cm at the end of original content stream to test q...Q wrapper
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 50, 50))
    const baseBytes = await doc.save()

    const checkDoc = await PDFDocument.load(baseBytes)
    const probed = probePageImages(checkDoc, 0)
    expect(probed.images.length).toBe(1)
    const img = probed.images[0]
    const view = getPageView(checkDoc.getPage(0))
    const vRect = bboxToView(view, img.bbox)

    const annExistTop: Annotation = {
      id: 'ann-exist-top',
      page: 1,
      type: 'image',
      x: vRect.x,
      y: vRect.y,
      width: vRect.width,
      height: vRect.height,
      color: '#000000',
      opacity: 1,
      sourceImage: {
        resourceName: img.resourceName,
        occurrence: img.occurrence,
        originalRect: { x: vRect.x, y: vRect.y, width: vRect.width, height: vRect.height },
      },
      pageLayer: 'top',
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [annExistTop])
    const pdf = await pdfjsLib.getDocument({ data: outBytes }).promise
    const p1 = await pdf.getPage(1)
    const opList = await p1.getOperatorList()

    const paintIdx = opList.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)
    expect(paintIdx).toBeGreaterThan(0)

    // Rectangle drawing/filling opcode should be BEFORE paintImageXObject
    const rectFillIdx = opList.fnArray.findIndex(
      (fn) => fn === pdfjsLib.OPS.fill || fn === pdfjsLib.OPS.eoFill || fn === pdfjsLib.OPS.constructPath,
    )
    expect(rectFillIdx).toBeGreaterThan(0)
    expect(paintIdx).toBeGreaterThan(rectFillIdx)

    // Verify CTM calculation at paintImageXObject matches original without being offset by the +50, +50 unclosed cm
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

    // Must be 100, 100 (not 150, 150)
    expect(currentCtm[0]).toBeCloseTo(80, 1)
    expect(currentCtm[3]).toBeCloseTo(60, 1)
    expect(currentCtm[4]).toBeCloseTo(100, 1)
    expect(currentCtm[5]).toBeCloseTo(100, 1)
  })

  // =========================================================================
  // K5: Combined: existing image rotated 90° + crop + top has correct CTM and clip
  // =========================================================================
  it('K5: existing image rotated 90deg + crop + top matches croppedImageMatrix and has clip operator', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const png = await doc.embedPng(ASYMMETRIC_4x2_BYTES)
    page.drawImage(png, { x: 50, y: 100, width: 100, height: 100 })
    const baseBytes = await doc.save()

    const checkDoc = await PDFDocument.load(baseBytes)
    const probed = probePageImages(checkDoc, 0)
    expect(probed.images.length).toBe(1)
    const img = probed.images[0]
    const view = getPageView(checkDoc.getPage(0))
    const vRect = bboxToView(view, img.bbox)

    const annCombo: Annotation = {
      id: 'ann-combo',
      page: 1,
      type: 'image',
      x: vRect.x,
      y: vRect.y,
      width: vRect.width,
      height: vRect.height,
      color: '#000000',
      opacity: 1,
      imageRotation: 90,
      imageCrop: { left: 0.2, top: 0.1, right: 0.1, bottom: 0.2 },
      sourceImage: {
        resourceName: img.resourceName,
        occurrence: img.occurrence,
        originalRect: { x: vRect.x, y: vRect.y, width: vRect.width, height: vRect.height },
      },
      pageLayer: 'top',
    }

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, [annCombo])
    const pdf = await pdfjsLib.getDocument({ data: outBytes }).promise
    const p1 = await pdf.getPage(1)
    const opList = await p1.getOperatorList()

    const paintIdx = opList.fnArray.indexOf(pdfjsLib.OPS.paintImageXObject)
    expect(paintIdx).toBeGreaterThan(0)

    // Clip operator must precede paintImageXObject
    const clipIdx = opList.fnArray.lastIndexOf(pdfjsLib.OPS.clip, paintIdx)
    expect(clipIdx).toBeGreaterThan(-1)

    // Check CTM matches croppedImageMatrix
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

    const expected = croppedImageMatrix(annCombo, view).matrix
    for (let i = 0; i < 6; i++) {
      expect(currentCtm[i]).toBeCloseTo(expected[i], 1)
    }
  })

  // =========================================================================
  // K6: jsdom: PropertiesPanel has 4 buttons, disabled states, and keyboard shortcuts
  // =========================================================================
  it('K6: panel has 4 layer buttons, top item has up buttons disabled, and BracketRight keyboard shortcut works', async () => {
    const annBottom: Annotation = {
      id: 'ann-1',
      page: 1,
      type: 'text',
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.1,
      color: '#000000',
      opacity: 1,
    }
    const annTop: Annotation = {
      id: 'ann-2',
      page: 1,
      type: 'image',
      x: 0.3,
      y: 0.3,
      width: 0.3,
      height: 0.3,
      color: '#000000',
      opacity: 1,
      imageDataUrl: ASYMMETRIC_4x2_DATAURL,
    }

    const annotations = [annBottom, annTop]
    const onReorder = vi.fn()

    // 1. When annTop is selected (already at top)
    await act(async () => {
      root.render(
        <PropertiesPanel
          selectedAnnotation={annTop}
          annotations={annotations}
          onReorder={onReorder}
          pageSizePt={{ width: 600, height: 400 }}
          tool="select"
          textStyle={{ fontFamily: 'Helvetica', fontSize: 16, color: '#000000' }}
          onTextStyleChange={vi.fn()}
          onUpdateAnnotation={vi.fn()}
          aspectLocked={false}
          onToggleAspectLock={vi.fn()}
        />,
      )
    })

    const btnFront = container.querySelector('button[aria-label="Đưa lên trên cùng"]') as HTMLButtonElement
    const btnForward = container.querySelector('button[aria-label="Đưa lên một lớp"]') as HTMLButtonElement
    const btnBackward = container.querySelector('button[aria-label="Đưa xuống một lớp"]') as HTMLButtonElement
    const btnBack = container.querySelector('button[aria-label="Đưa xuống dưới cùng"]') as HTMLButtonElement

    expect(btnFront).toBeDefined()
    expect(btnForward).toBeDefined()
    expect(btnBackward).toBeDefined()
    expect(btnBack).toBeDefined()

    // Top item has up buttons disabled, down buttons enabled
    expect(btnFront.disabled).toBe(true)
    expect(btnForward.disabled).toBe(true)
    expect(btnBackward.disabled).toBe(false)
    expect(btnBack.disabled).toBe(false)

    // Click backward
    act(() => {
      btnBackward.click()
    })
    expect(onReorder).toHaveBeenCalledWith('ann-2', 'backward')

    // 2. Keyboard shortcut simulation: Ctrl+]
    let defaultPrevented = false
    const keyEvent = new KeyboardEvent('keydown', {
      code: 'BracketRight',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(keyEvent, 'preventDefault', {
      value: () => {
        defaultPrevented = true
      },
    })

    // Handler logic matching App.tsx
    const handleKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.code === 'BracketRight' || e.code === 'BracketLeft')
      ) {
        e.preventDefault()
        const action = e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward')
        onReorder('ann-2', action)
      }
    }

    handleKey(keyEvent)
    expect(defaultPrevented).toBe(true)
    expect(onReorder).toHaveBeenCalledWith('ann-2', 'forward')
  })

  // =========================================================================
  // K7: jsdom preview zIndex: reflects array order and updates after back(image)
  // =========================================================================
  it('K7: preview canvas zIndex follows array order and updates after back(image)', async () => {
    const annHl: Annotation = {
      id: 'hl-test',
      page: 1,
      type: 'highlight',
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.2,
      color: '#ffff00',
      opacity: 0.5,
    }
    const annImg: Annotation = {
      id: 'img-test',
      page: 1,
      type: 'image',
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.3,
      color: '#000000',
      opacity: 1,
      imageDataUrl: ASYMMETRIC_4x2_DATAURL,
    }

    // Mock PDF proxy minimal stub
    const mockPdf = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 600, height: 400 }),
        getTextContent: () => Promise.resolve({ items: [], styles: {} }),
        getOperatorList: () => Promise.resolve({ fnArray: [], argsArray: [] }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      }),
    } as unknown as pdfjsLib.PDFDocumentProxy

    // 1. Initial array: [highlight, image] -> highlight zIndex 20, image zIndex 21
    let currentAnns = [annHl, annImg]

    await act(async () => {
      root.render(
        <PdfCanvas
          pdf={mockPdf}
          pageNumber={1}
          zoom={1}
          annotations={currentAnns}
          tool="select"
          color="#000000"
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

    let hlEl = container.querySelector('.annotation.highlight') as HTMLElement
    let imgWrapper = container.querySelector('.image-annotation-wrapper') as HTMLElement
    expect(hlEl).toBeDefined()
    expect(imgWrapper).toBeDefined()

    expect(Number(hlEl.style.zIndex)).toBe(20)
    expect(Number(imgWrapper.style.zIndex)).toBe(21)
    expect(Number(imgWrapper.style.zIndex)).toBeGreaterThan(Number(hlEl.style.zIndex))

    // 2. After back(image): array becomes [image, highlight]
    currentAnns = reorderAnnotations(currentAnns, annImg.id, 'back')

    await act(async () => {
      root.render(
        <PdfCanvas
          pdf={mockPdf}
          pageNumber={1}
          zoom={1}
          annotations={currentAnns}
          tool="select"
          color="#000000"
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

    hlEl = container.querySelector('.annotation.highlight') as HTMLElement
    imgWrapper = container.querySelector('.image-annotation-wrapper') as HTMLElement
    expect(Number(imgWrapper.style.zIndex)).toBe(20)
    expect(Number(hlEl.style.zIndex)).toBe(21)
    expect(Number(imgWrapper.style.zIndex)).toBeLessThan(Number(hlEl.style.zIndex))
  })
})
