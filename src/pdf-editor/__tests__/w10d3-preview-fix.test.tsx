import 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type * as pdfjs from 'pdfjs-dist'
import type { Annotation, PageImageRegion } from '../../types'
import { extractCleanImagePreview } from '../imagePlacement'
import { PdfCanvas } from '../PdfCanvas'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('W-10d3: Existing image preview position matching and single onAdd suite', () => {
  let container: HTMLDivElement
  let root: Root
  let origToDataURL: typeof HTMLCanvasElement.prototype.toDataURL
  let origGetContext: typeof HTMLCanvasElement.prototype.getContext
  let currentMockDataUrl: string

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    currentMockDataUrl = 'data:image/png;base64,defaultCleanMock'

    origToDataURL = HTMLCanvasElement.prototype.toDataURL
    origGetContext = HTMLCanvasElement.prototype.getContext

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
    vi.useRealTimers()
  })

  // =========================================================================
  // (a) operator list giả có 2 ảnh img_p0_1 (vị trí A) và img_p0_2 (vị trí B),
  //     vùng chọn ở vị trí B → hàm chọn img_p0_2
  // =========================================================================
  describe('(a) position matching in operator list', () => {
    it('selects img_p0_2 when selecting region at position B', async () => {
      // Position A: CTM [100, 0, 0, 80, 50, 150] -> bbox { x: 50, y: 150, width: 100, height: 80 }
      // Position B: CTM [200, 0, 0, 120, 250, 350] -> bbox { x: 250, y: 350, width: 200, height: 120 }
      const mockOpList = {
        fnArray: [
          10, // save
          12, // transform
          85, // paintImageXObject -> img_p0_1 at position A
          11, // restore
          10, // save
          12, // transform
          85, // paintImageXObject -> img_p0_2 at position B
          11, // restore
        ],
        argsArray: [
          [],
          [100, 0, 0, 80, 50, 150],
          ['img_p0_1'],
          [],
          [],
          [200, 0, 0, 120, 250, 350],
          ['img_p0_2'],
          [],
        ],
      }

      const mockImgData = {
        width: 2,
        height: 2,
        kind: 3,
        data: new Uint8ClampedArray(16),
      }

      const requestedIds: string[] = []
      const mockPage = {
        getOperatorList: vi.fn().mockResolvedValue(mockOpList),
        objs: {
          get: vi.fn((id: string, cb?: (data: unknown) => void) => {
            requestedIds.push(id)
            if (cb) cb(mockImgData)
            return mockImgData
          }),
          has: vi.fn().mockReturnValue(true),
        },
      }

      // Selected image region is at position B
      const regionAtB = {
        resourceName: 'Im2',
        occurrence: 0,
        x: 0.25,
        y: 0.35,
        width: 0.2,
        height: 0.12,
        pdfBbox: { x: 250, y: 350, width: 200, height: 120 },
      }

      const result = await extractCleanImagePreview(mockPage, regionAtB)

      expect(mockPage.getOperatorList).toHaveBeenCalled()
      expect(mockPage.objs.get).toHaveBeenCalledWith('img_p0_2', expect.any(Function))
      expect(requestedIds).toContain('img_p0_2')
      expect(requestedIds).not.toContain('img_p0_1')
      expect(result).toBe('data:image/png;base64,defaultCleanMock')
    })

    it('falls back to captureCanvasPreview when no operator matches position B', async () => {
      const mockOpList = {
        fnArray: [10, 12, 85, 11],
        argsArray: [[], [100, 0, 0, 80, 50, 150], ['img_p0_1'], []],
      }

      const mockPage = {
        getOperatorList: vi.fn().mockResolvedValue(mockOpList),
        objs: {
          get: vi.fn(),
          has: vi.fn().mockReturnValue(true),
        },
      }

      const fallbackCanvas = document.createElement('canvas')
      fallbackCanvas.width = 100
      fallbackCanvas.height = 100
      ;(fallbackCanvas as unknown as { _mockDataUrl?: string })._mockDataUrl = 'data:image/png;base64,fallbackNoMatch'

      // Region at unmatched position C
      const regionAtC = {
        resourceName: 'ImUnknown',
        occurrence: 0,
        x: 0.8,
        y: 0.8,
        width: 0.1,
        height: 0.1,
        pdfBbox: { x: 500, y: 500, width: 50, height: 50 },
      }

      const result = await extractCleanImagePreview(
        mockPage,
        regionAtC,
        fallbackCanvas,
        { width: 100, height: 100 },
      )

      expect(mockPage.objs.get).not.toHaveBeenCalled()
      expect(result).toBe('data:image/png;base64,fallbackNoMatch')
    })
  })

  // =========================================================================
  // (b) PdfCanvas (jsdom): bấm vùng ảnh → onAdd được gọi đúng 1 lần với
  //     imageDataUrl cuối cùng; onUpdate không được gọi sau đó
  // =========================================================================
  describe('(b) single onAdd without subsequent onUpdate in PdfCanvas', () => {
    it('calls onAdd exactly once with clean imageDataUrl and never calls onUpdate', async () => {
      const mockImgData = {
        width: 4,
        height: 4,
        kind: 3,
        data: new Uint8ClampedArray(64),
      }

      currentMockDataUrl = 'data:image/png;base64,cleanReadyPreview'

      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
        getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
        getOperatorList: vi.fn().mockResolvedValue({
          fnArray: [10, 12, 85, 11],
          argsArray: [[], [180, 0, 0, 160, 60, 160], ['img_p0_target'], []],
        }),
        objs: {
          get: vi.fn((_id: string, cb?: (data: unknown) => void) => {
            if (cb) cb(mockImgData)
            return mockImgData
          }),
          has: vi.fn().mockReturnValue(true),
        },
      }

      const mockPdf = {
        getPage: vi.fn().mockResolvedValue(mockPage),
      } as unknown as pdfjs.PDFDocumentProxy

      const pageImages: PageImageRegion[] = [
        {
          id: 'img-1-Im1-0',
          page: 1,
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.2,
          resourceName: 'Im1',
          occurrence: 0,
          editable: true,
          pdfBbox: { x: 60, y: 160, width: 180, height: 160 },
        },
      ]

      const onAdd = vi.fn()
      const onUpdate = vi.fn()

      await act(async () => {
        root.render(
          <PdfCanvas
            pdf={mockPdf}
            pageNumber={1}
            zoom={1}
            annotations={[]}
            tool="select"
            color="#000000"
            onAdd={onAdd}
            onUpdate={onUpdate}
            selectedId={null}
            onSelect={vi.fn()}
            textRegions={[]}
            onTextRegions={vi.fn()}
            onEditRegion={vi.fn()}
            onEditAnnotation={vi.fn()}
            pageImages={pageImages}
          />,
        )
      })

      const btn = container.querySelector('button.page-image-region') as HTMLButtonElement
      expect(btn).not.toBeNull()

      await act(async () => {
        btn.click()
      })

      // 1. onAdd called exactly 1 time
      expect(onAdd).toHaveBeenCalledTimes(1)
      const created = onAdd.mock.calls[0][0] as Annotation
      expect(created.type).toBe('image')
      expect(created.imageDataUrl).toBe('data:image/png;base64,cleanReadyPreview')

      // 2. onUpdate was NEVER called afterwards
      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // (c) lấy ảnh sạch quá 1.500 ms → dùng ảnh cắt từ canvas, vẫn chỉ tạo annotation 1 lần
  // =========================================================================
  describe('(c) timeout over 1,500ms falls back to canvas crop and creates annotation once', () => {
    it('uses fallback canvas crop when clean extraction exceeds 1500ms timeout', async () => {
      vi.useFakeTimers()

      const fallbackCanvas = document.createElement('canvas')
      fallbackCanvas.width = 100
      fallbackCanvas.height = 100
      ;(fallbackCanvas as unknown as { _mockDataUrl?: string })._mockDataUrl = 'data:image/png;base64,fallbackTimeoutCrop'

      // Mock page whose objs.get never resolves (simulating slow/hanging worker)
      const mockPage = {
        getOperatorList: vi.fn().mockResolvedValue({
          fnArray: [10, 12, 85, 11],
          argsArray: [[], [100, 0, 0, 100, 10, 10], ['img_hanging'], []],
        }),
        objs: {
          get: vi.fn(() => {
            // never calls callback
            return null
          }),
          has: vi.fn().mockReturnValue(false),
        },
      }

      const imgRegion = {
        resourceName: 'ImSlow',
        occurrence: 0,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        pdfBbox: { x: 10, y: 10, width: 100, height: 100 },
      }

      const extractPromise = extractCleanImagePreview(
        mockPage,
        imgRegion,
        fallbackCanvas,
        { width: 100, height: 100 },
        1500,
      )

      // Advance timers by 1,600ms to trigger timeout
      await act(async () => {
        vi.advanceTimersByTime(1600)
      })

      const result = await extractPromise
      expect(result).toBe('data:image/png;base64,fallbackTimeoutCrop')
    })

    it('PdfCanvas creates annotation once with fallback when clean preview hangs', async () => {
      vi.useFakeTimers()

      currentMockDataUrl = 'data:image/png;base64,canvasFallbackAfterTimeout'

      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() }),
        getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
        getOperatorList: vi.fn().mockResolvedValue({
          fnArray: [10, 12, 85, 11],
          argsArray: [[], [180, 0, 0, 160, 60, 160], ['img_hanging_canvas'], []],
        }),
        objs: {
          get: vi.fn(() => null), // never resolves
          has: vi.fn().mockReturnValue(false),
        },
      }

      const mockPdf = {
        getPage: vi.fn().mockResolvedValue(mockPage),
      } as unknown as pdfjs.PDFDocumentProxy

      const pageImages: PageImageRegion[] = [
        {
          id: 'img-1-Im1-0',
          page: 1,
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.2,
          resourceName: 'Im1',
          occurrence: 0,
          editable: true,
          pdfBbox: { x: 60, y: 160, width: 180, height: 160 },
        },
      ]

      const onAdd = vi.fn()
      const onUpdate = vi.fn()

      await act(async () => {
        root.render(
          <PdfCanvas
            pdf={mockPdf}
            pageNumber={1}
            zoom={1}
            annotations={[]}
            tool="select"
            color="#000000"
            onAdd={onAdd}
            onUpdate={onUpdate}
            selectedId={null}
            onSelect={vi.fn()}
            textRegions={[]}
            onTextRegions={vi.fn()}
            onEditRegion={vi.fn()}
            onEditAnnotation={vi.fn()}
            pageImages={pageImages}
          />,
        )
      })

      const btn = container.querySelector('button.page-image-region') as HTMLButtonElement
      expect(btn).not.toBeNull()

      const clickPromise = act(async () => {
        btn.click()
        vi.advanceTimersByTime(1600)
      })

      await clickPromise

      // Created exactly once with canvas fallback
      expect(onAdd).toHaveBeenCalledTimes(1)
      const created = onAdd.mock.calls[0][0] as Annotation
      expect(created.imageDataUrl).toBe('data:image/png;base64,canvasFallbackAfterTimeout')
      expect(onUpdate).not.toHaveBeenCalled()
    })
  })
})
