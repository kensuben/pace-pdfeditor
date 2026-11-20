// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { getPageView, viewSizePt, viewToPdf } from '../pageGeometry'

interface FixtureConfig {
  name: string
  rotation: 0 | 90 | 180 | 270
  mediaBox: [number, number, number, number]
  cropBox?: [number, number, number, number]
}

function generateMatrixConfigs(): FixtureConfig[] {
  const rotations: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270]
  const mediaBoxes: Array<[number, number, number, number]> = [
    [0, 0, 600, 400],
    [100, 100, 700, 500],
  ]
  const cropBoxes: Array<[number, number, number, number] | undefined> = [
    undefined,
    [150, 120, 650, 480],
  ]

  const configs: FixtureConfig[] = []
  for (const rot of rotations) {
    for (const mb of mediaBoxes) {
      for (const cb of cropBoxes) {
        configs.push({
          name: `rot=${rot}_mb=[${mb.join(',')}]_cb=${cb ? `[${cb.join(',')}]` : 'none'}`,
          rotation: rot,
          mediaBox: mb,
          cropBox: cb,
        })
      }
    }
  }
  return configs
}

describe('pageGeometry Unit Tests (F-12 K1 & K7)', () => {
  it('K1: viewToPdf and viewSizePt match pdf.js viewport across all 16 matrix M pages', async () => {
    const configs = generateMatrixConfigs()
    expect(configs.length).toBe(16)

    const points = [
      { u: 0, v: 0 },
      { u: 0.5, v: 0 },
      { u: 1, v: 0 },
      { u: 0, v: 0.5 },
      { u: 0.5, v: 0.5 },
      { u: 1, v: 0.5 },
      { u: 0, v: 1 },
      { u: 0.5, v: 1 },
      { u: 1, v: 1 },
    ]

    let passedPages = 0

    for (const cfg of configs) {
      const doc = await PDFDocument.create()
      const [mx0, my0, mx1, my1] = cfg.mediaBox
      const page = doc.addPage([mx1 - mx0, my1 - my0])
      page.setMediaBox(mx0, my0, mx1 - mx0, my1 - my0)
      if (cfg.cropBox) {
        const [cx0, cy0, cx1, cy1] = cfg.cropBox
        page.setCropBox(cx0, cy0, cx1 - cx0, cy1 - cy0)
      }
      if (cfg.rotation !== 0) {
        page.node.set(PDFName.of('Rotate'), PDFNumber.of(cfg.rotation))
      }

      const view = getPageView(page)
      const size = viewSizePt(view)

      const pdfBytes = new Uint8Array(await doc.save())
      const loaded = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise
      const pdfPage = await loaded.getPage(1)
      const viewport = pdfPage.getViewport({ scale: 1 })

      // Check view size matches pdf.js viewport dimensions:
      expect(Math.abs(size.width - viewport.width)).toBeLessThanOrEqual(0.01)
      expect(Math.abs(size.height - viewport.height)).toBeLessThanOrEqual(0.01)

      // Check all 9 points match convertToPdfPoint:
      for (const pt of points) {
        const ourPdfPt = viewToPdf(view, pt.u, pt.v)
        const [jsPdfX, jsPdfY] = viewport.convertToPdfPoint(pt.u * viewport.width, pt.v * viewport.height)

        expect(Math.abs(ourPdfPt.x - jsPdfX)).toBeLessThanOrEqual(0.01)
        expect(Math.abs(ourPdfPt.y - jsPdfY)).toBeLessThanOrEqual(0.01)
      }

      passedPages++
    }

    expect(passedPages).toBe(16)
  })

  it('K7: throws UNSUPPORTED_ROTATION when page rotation is not a multiple of 90 degrees', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(45))

    expect(() => getPageView(page)).toThrowError(/^UNSUPPORTED_ROTATION:/)
  })
})
