import { describe, it, expect, vi } from 'vitest'
import { croppedPreviewLayout, sampleBackground } from '../imagePlacement'

describe('W-10c2: Preview Layout and Outside Color Sampling', () => {
  // =========================================================================
  // (a) trang 595×842 px, ảnh khung (0.1, 0.1, 0.1, 0.2) xoay 90°
  // =========================================================================
  it('(a) 595x842 page, rect (0.1, 0.1, 0.1, 0.2) rotated 90deg returns upright width=0.2*842, height=0.1*595 (+-0.5px)', () => {
    const a = {
      x: 0.1,
      y: 0.1,
      width: 0.1,
      height: 0.2,
      imageRotation: 90,
    }
    const pageSize = { width: 595, height: 842 }
    const layout = croppedPreviewLayout(a, pageSize)

    const expectedW = 0.2 * 842 // 168.4
    const expectedH = 0.1 * 595 // 59.5

    expect(Math.abs(layout.fullWidth - expectedW)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(layout.fullHeight - expectedH)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(layout.width - expectedW)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(layout.height - expectedH)).toBeLessThanOrEqual(0.5)
    expect(layout.dx).toBeCloseTo(0, 5)
    expect(layout.dy).toBeCloseTo(0, 5)
  })

  // =========================================================================
  // (b) như (a) thêm crop { left: 0.5 }: ảnh đầy đủ rộng gấp đôi phần còn lại, độ dời đúng
  // =========================================================================
  it('(b) same as (a) with crop left: 0.5: full image is twice as wide as remaining part, offset is correct', () => {
    const a = {
      x: 0.1,
      y: 0.1,
      width: 0.1,
      height: 0.2,
      imageRotation: 90,
    }
    const aWithCrop = {
      ...a,
      imageCrop: { left: 0.5, top: 0, right: 0, bottom: 0 },
    }
    const pageSize = { width: 595, height: 842 }
    const layoutBase = croppedPreviewLayout(a, pageSize)
    const layoutCropped = croppedPreviewLayout(aWithCrop, pageSize)

    // Full image width is twice as wide as remaining part
    const remW = 0.2 * 842
    expect(layoutCropped.fullWidth).toBeCloseTo(remW * 2, 1)
    expect(layoutCropped.fullWidth).toBeCloseTo(layoutBase.fullWidth * 2, 1)

    // Offset: dXi = ((right - left) / (2 * sx)) * remW = ((0 - 0.5) / (2 * 0.5)) * remW = -0.5 * remW
    const expectedDx = -0.5 * remW // -84.2
    expect(layoutCropped.dx).toBeCloseTo(expectedDx, 1)
    expect(layoutCropped.dy).toBeCloseTo(0, 1)
  })

  // =========================================================================
  // (c) không xoay, không cắt: kết quả giống công thức cũ (hồi quy W-10b)
  // =========================================================================
  it('(c) unrotated, uncropped: matches previous formula (regression W-10b)', () => {
    const a = {
      x: 0.15,
      y: 0.25,
      width: 0.3,
      height: 0.4,
    }
    const pageSize = { width: 595, height: 842 }
    const layout = croppedPreviewLayout(a, pageSize)

    // Previous W-10b formula: fullW = a.width * pageSize.width, fullH = a.height * pageSize.height
    const oldW = a.width * pageSize.width
    const oldH = a.height * pageSize.height

    expect(layout.fullWidth).toBeCloseTo(oldW, 2)
    expect(layout.fullHeight).toBeCloseTo(oldH, 2)
    expect(layout.width).toBeCloseTo(oldW, 2)
    expect(layout.height).toBeCloseTo(oldH, 2)
    expect(layout.dx).toBe(0)
    expect(layout.dy).toBe(0)
  })

  // =========================================================================
  // (d) lấy mẫu outside trên canvas giả (jsdom): khung toàn màu xám nằm trên nền trắng → trả #ffffff
  // =========================================================================
  it('(d) outside sampling on mock canvas: gray box on white background returns #ffffff', () => {
    const mockCanvas = document.createElement('canvas')
    mockCanvas.width = 200
    mockCanvas.height = 200

    const pageSize = { width: 200, height: 200 }
    // Region occupies normalized box [0.25, 0.25, 0.5, 0.5] -> [50, 50, 100, 100] in canvas px
    const region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

    // Mock 2D context where [50, 50, 150, 150] is gray (128, 128, 128) and outside is white (255, 255, 255)
    const mockCtx = {
      getImageData: (x: number, y: number) => {
        const isInsideGray = x >= 50 && x <= 150 && y >= 50 && y <= 150
        const color = isInsideGray ? [128, 128, 128, 255] : [255, 255, 255, 255]
        return { data: new Uint8ClampedArray(color) }
      },
    }
    mockCanvas.getContext = vi.fn().mockReturnValue(mockCtx)

    // When outside: true is passed, it samples 2-4px ring outside the box -> all white -> #ffffff
    const outsideColor = sampleBackground(region, mockCanvas, pageSize, { outside: true })
    expect(outsideColor.toLowerCase()).toBe('#ffffff')

    // Regression check: default inside sampling on the same canvas gets the gray color
    const insideColor = sampleBackground(region, mockCanvas, pageSize)
    expect(insideColor.toLowerCase()).toBe('#808080')
  })
})
