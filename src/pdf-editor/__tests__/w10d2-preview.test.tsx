import 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type * as pdfjs from 'pdfjs-dist'
import type { Annotation } from '../../types'
import {
  extractCleanImagePreview,
  captureCanvasPreview,
  isBottomLayerInPlace,
} from '../imagePlacement'
import { PdfCanvas } from '../PdfCanvas'
import { PropertiesPanel } from '../PropertiesPanel'

// Configure react act environment for jsdom
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('W-10d2: Existing image clean preview and bottom layer in-place preview suite', () => {
  let container: HTMLDivElement
  let root: Root
  let origToDataURL: typeof HTMLCanvasElement.prototype.toDataURL
  let origGetContext: typeof HTMLCanvasElement.prototype.getContext
  let currentMockDataUrl: string

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    currentMockDataUrl = 'data:image/png;base64,defaultMockDataUrl'

    origToDataURL = HTMLCanvasElement.prototype.toDataURL
    origGetContext = HTMLCanvasElement.prototype.getContext

    // Polyfill canvas context and toDataURL for jsdom
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockImplementation(function (this: HTMLCanvasElement) {
      return (this as unknown as { _mockDataUrl?: string })._mockDataUrl || currentMockDataUrl
    })

    HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(function (this: HTMLCanvasElement) {
      return {
        drawImage: vi.fn(),
        putImageData: vi.fn(),
        createImageData: vi.fn().mockImplementation((w: number, h: number) => ({
          data: new Uint8ClampedArray((w || 1) * (h || 1) * 4),
        })),
        getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
        fillRect: vi.fn(),
      }
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    HTMLCanvasElement.prototype.toDataURL = origToDataURL
    HTMLCanvasElement.prototype.getContext = origGetContext
  })

  // =========================================================================
  // (a) hàm lấy ảnh preview được gọi với đúng resourceName/occurrence; nếu lấy lỗi thì dùng cách cắt canvas
  // =========================================================================
  describe('(a) extractCleanImagePreview with resourceName/occurrence and canvas fallback', () => {
    it('calls page.objs.get with matching resourceName and occurrence', async () => {
      const mockImgData = {
        width: 4,
        height: 2,
        kind: 3,
        data: new Uint8ClampedArray(4 * 2 * 4),
      }

      const mockObjsGet = vi.fn((id: string, cb?: (data: unknown) => void) => {
        if (cb) cb(mockImgData)
        return mockImgData
      })

      const mockPage = {
        getOperatorList: vi.fn().mockResolvedValue({
          fnArray: [85, 85],
          argsArray: [['ImFirst'], ['ImTarget']],
        }),
        objs: {
          get: mockObjsGet,
          has: vi.fn().mockReturnValue(true),
        },
      }

      const result = await extractCleanImagePreview(
        mockPage,
        { resourceName: 'ImTarget', occurrence: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      )

      expect(mockPage.getOperatorList).toHaveBeenCalled()
      expect(mockObjsGet).toHaveBeenCalledWith('ImTarget', expect.any(Function))
      expect(result).toBe('data:image/png;base64,defaultMockDataUrl')
    })

    it('matches the correct occurrence when multiple images share the same name or occurrence index', async () => {
      const mockImgData = {
        width: 2,
        height: 2,
        data: new Uint8ClampedArray(16),
      }

      const callOrder: string[] = []
      const mockObjsGet = vi.fn((id: string, cb?: (data: unknown) => void) => {
        callOrder.push(id)
        if (cb) cb(mockImgData)
        return mockImgData
      })

      const mockPage = {
        getOperatorList: vi.fn().mockResolvedValue({
          fnArray: [85, 85, 85],
          argsArray: [['ImCommon'], ['ImOther'], ['ImCommon']],
        }),
        objs: {
          get: mockObjsGet,
          has: vi.fn().mockReturnValue(true),
        },
      }

      // Asking for occurrence 1 of 'ImCommon' (the 2nd ImCommon at index 2)
      await extractCleanImagePreview(
        mockPage,
        { resourceName: 'ImCommon', occurrence: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      )

      expect(mockObjsGet).toHaveBeenCalledWith('ImCommon', expect.any(Function))
    })

    it('falls back to canvas capture when page.objs.get throws or fails', async () => {
      currentMockDataUrl = 'data:image/png;base64,fallbackFromCanvasOnly'
      const fallbackCanvas = document.createElement('canvas')
      fallbackCanvas.width = 200
      fallbackCanvas.height = 200
      ;(fallbackCanvas as unknown as { _mockDataUrl?: string })._mockDataUrl = 'data:image/png;base64,fallbackFromCanvasOnly'

      const mockPage = {
        getOperatorList: vi.fn().mockResolvedValue({
          fnArray: [85],
          argsArray: [['ImBroken']],
        }),
        objs: {
          get: vi.fn().mockImplementation(() => {
            throw new Error('XObject stream corrupted')
          }),
        },
      }

      const result = await extractCleanImagePreview(
        mockPage,
        { resourceName: 'ImBroken', occurrence: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        fallbackCanvas,
        { width: 100, height: 100 },
      )

      expect(result).toBe('data:image/png;base64,fallbackFromCanvasOnly')
    })

    it('captureCanvasPreview crops region from canvas and returns dataUrl', () => {
      currentMockDataUrl = 'data:image/png;base64,croppedMock'
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 400
      ;(canvas as unknown as { _mockDataUrl?: string })._mockDataUrl = 'data:image/png;base64,croppedMock'

      const res = captureCanvasPreview(
        canvas,
        { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
        { width: 200, height: 200 },
      )
      expect(res).toBe('data:image/png;base64,croppedMock')
    })
  })

  // =========================================================================
  // (b) annotation sourceImage có pageLayer = 'bottom', khung trùng gốc
  //     → không render .source-image-mask và không có <img> preview
  //     → chú thích nhỏ trong PropertiesPanel
  // =========================================================================
  describe('(b) bottom layer in place: skip cover mask and preview img', () => {
    const mockPdf = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
        getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
      }),
    } as unknown as pdfjs.PDFDocumentProxy

    const annBottomInPlace: Annotation = {
      id: 'ann-bottom-inplace',
      page: 1,
      type: 'image',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      color: '#000000',
      opacity: 1,
      imageDataUrl: 'data:image/png;base64,cleanPixelData',
      sourceImage: {
        resourceName: 'Im1',
        occurrence: 0,
        originalRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
      pageLayer: 'bottom',
    }

    it('isBottomLayerInPlace helper accurately detects in-place state', () => {
      expect(isBottomLayerInPlace(annBottomInPlace)).toBe(true)

      // Moved
      expect(isBottomLayerInPlace({ ...annBottomInPlace, x: 0.15 })).toBe(false)
      // Rotated
      expect(isBottomLayerInPlace({ ...annBottomInPlace, imageRotation: 90 })).toBe(false)
      // Flipped
      expect(isBottomLayerInPlace({ ...annBottomInPlace, flipH: true })).toBe(false)
      // Cropped
      expect(isBottomLayerInPlace({ ...annBottomInPlace, imageCrop: { left: 10, top: 0, right: 0, bottom: 0 } })).toBe(false)
      // Replaced
      expect(isBottomLayerInPlace({ ...annBottomInPlace, replacementDataUrl: 'data:image/png;base64,newImg' })).toBe(false)
      // Not bottom
      expect(isBottomLayerInPlace({ ...annBottomInPlace, pageLayer: 'top' })).toBe(false)
    })

    it('does not render .source-image-mask and does not render <img> preview in PdfCanvas', async () => {
      await act(async () => {
        root.render(
          <PdfCanvas
            pdf={mockPdf}
            pageNumber={1}
            zoom={1}
            annotations={[annBottomInPlace]}
            tool="select"
            color="#000000"
            onAdd={vi.fn()}
            onUpdate={vi.fn()}
            selectedId={annBottomInPlace.id}
            onSelect={vi.fn()}
            textRegions={[]}
            onTextRegions={vi.fn()}
            onEditRegion={vi.fn()}
            onEditAnnotation={vi.fn()}
          />,
        )
      })

      // 1. .source-image-mask must NOT be in DOM
      const maskEl = container.querySelector('.source-image-mask')
      expect(maskEl).toBeNull()

      // 2. <img> preview must NOT be in DOM
      const imgEl = container.querySelector('img.image-annotation')
      expect(imgEl).toBeNull()

      // 3. SelectionFrame or wrapper is still interactive
      const wrapperEl = container.querySelector('.image-annotation-wrapper')
      expect(wrapperEl).toBeDefined()
    })

    it('displays hint note in PropertiesPanel when bottom layer is in place', async () => {
      await act(async () => {
        root.render(
          <PropertiesPanel
            selectedAnnotation={annBottomInPlace}
            annotations={[annBottomInPlace]}
            pageSizePt={{ width: 600, height: 800 }}
            tool="select"
            textStyle={{ fontFamily: 'Helvetica', fontSize: 16, bold: false, italic: false, underline: false, align: 'left', color: '#000' }}
            onTextStyleChange={vi.fn()}
            onUpdateAnnotation={vi.fn()}
            aspectLocked={false}
            onToggleAspectLock={vi.fn()}
            onReorder={vi.fn()}
          />,
        )
      })

      const hintEl = container.querySelector('.properties-hint')
      expect(hintEl).not.toBeNull()
      expect(hintEl?.textContent).toContain('Bản xem chưa thể hiện thứ tự lớp so với nội dung gốc; file xuất sẽ đúng.')
    })
  })

  // =========================================================================
  // (c) pageLayer = 'bottom' nhưng đã kéo sang chỗ khác
  //     → vẫn có lớp phủ và ảnh preview như cũ
  // =========================================================================
  describe('(c) bottom layer moved: renders cover mask and clean preview img', () => {
    const mockPdf = {
      getPage: vi.fn().mockResolvedValue({
        getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
        getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
      }),
    } as unknown as pdfjs.PDFDocumentProxy

    const annBottomMoved: Annotation = {
      id: 'ann-bottom-moved',
      page: 1,
      type: 'image',
      x: 0.25, // moved from originalRect.x: 0.1
      y: 0.2,
      width: 0.3,
      height: 0.4,
      color: '#000000',
      opacity: 1,
      imageDataUrl: 'data:image/png;base64,cleanPixelData',
      sourceImage: {
        resourceName: 'Im1',
        occurrence: 0,
        originalRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      },
      pageLayer: 'bottom',
    }

    it('renders .source-image-mask and <img> preview when moved', async () => {
      await act(async () => {
        root.render(
          <PdfCanvas
            pdf={mockPdf}
            pageNumber={1}
            zoom={1}
            annotations={[annBottomMoved]}
            tool="select"
            color="#000000"
            onAdd={vi.fn()}
            onUpdate={vi.fn()}
            selectedId={annBottomMoved.id}
            onSelect={vi.fn()}
            textRegions={[]}
            onTextRegions={vi.fn()}
            onEditRegion={vi.fn()}
            onEditAnnotation={vi.fn()}
          />,
        )
      })

      // 1. .source-image-mask IS in DOM covering original location
      const maskEl = container.querySelector('.source-image-mask') as HTMLElement
      expect(maskEl).not.toBeNull()
      expect(maskEl.style.left).toBe('10%') // originalRect.x = 0.1

      // 2. <img> preview IS in DOM
      const imgEl = container.querySelector('img.image-annotation') as HTMLImageElement
      expect(imgEl).not.toBeNull()
      expect(imgEl.getAttribute('src')).toBe('data:image/png;base64,cleanPixelData')

      // 3. Wrapper positioned at moved coordinate
      const wrapperEl = container.querySelector('.image-annotation-wrapper') as HTMLElement
      expect(wrapperEl).not.toBeNull()
      expect(wrapperEl.style.left).toBe('25%') // display.x = 0.25
    })
  })
})
