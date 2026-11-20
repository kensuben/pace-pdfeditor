// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Annotation } from '../../types'
import { buildEditedPdf } from '../exportPdf'
import { readPageContent } from '../engine/pageContent'
import { tokenizeContent } from '../engine/contentTokenizer'

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

async function createFixturePdfBytes(cfg: FixtureConfig): Promise<Uint8Array> {
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
  return new Uint8Array(await doc.save())
}

// 2x1 PNG: 2 pixels wide, 1 pixel high (RGB)
const PNG_2X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC'

const defaultLoadImageBytes = async (dataUrl: string): Promise<ArrayBuffer> => {
  const base64 = dataUrl.split(',')[1]
  const buf = Buffer.from(base64, 'base64')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe('Export Rotation & Offset Matrix Suite (F-12 K2–K7)', () => {
  const matrix = generateMatrixConfigs()

  it('K2: highlight rect matches viewport rectangle across all 16 matrix M pages', async () => {
    let passed = 0
    for (const cfg of matrix) {
      const baseBytes = await createFixturePdfBytes(cfg)
      const hlAnn: Annotation = {
        id: 'ann-hl',
        page: 1,
        type: 'highlight',
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.1,
        color: '#F5C84C',
        opacity: 0.38,
      }

      const exportedBytes = await buildEditedPdf(baseBytes, [hlAnn])
      const loaded = await pdfjsLib.getDocument({ data: exportedBytes.slice() }).promise
      const pdfPage = await loaded.getPage(1)
      const viewport = pdfPage.getViewport({ scale: 1 })

      // Find the rectangle in the content stream
      const doc = await PDFDocument.load(exportedBytes)
      const content = readPageContent(doc, 0)
      const ops = tokenizeContent(content)

      const qIndices: number[] = []
      for (let i = 0; i < ops.length; i++) {
        if (ops[i].operator === 'q') qIndices.push(i)
      }
      const lastQ = qIndices[qIndices.length - 1]
      const hlOps = ops.slice(lastQ)

      let ctm = [1, 0, 0, 1, 0, 0]
      const rectCornersInPdf: Array<{ x: number; y: number }> = []

      for (const op of hlOps) {
        if (op.operator === 'cm') {
          const [m1, m2, m3, m4, m5, m6] = op.operands.map((o) => ('value' in o ? (o.value as number) : 0))
          const [a, b, c, d, e, f] = ctm
          ctm = [
            m1 * a + m2 * c,
            m1 * b + m2 * d,
            m3 * a + m4 * c,
            m3 * b + m4 * d,
            m5 * a + m6 * c + e,
            m5 * b + m6 * d + f,
          ]
        } else if (op.operator === 'm' || op.operator === 'l') {
          const [px, py] = op.operands.map((o) => ('value' in o ? (o.value as number) : 0))
          rectCornersInPdf.push({
            x: px * ctm[0] + py * ctm[2] + ctm[4],
            y: px * ctm[1] + py * ctm[3] + ctm[5],
          })
        }
      }

      const viewCoords = rectCornersInPdf.map((p) => {
        const [vx, vy] = viewport.convertToViewportPoint(p.x, p.y)
        return { vx, vy }
      })

      const minVx = Math.min(...viewCoords.map((c) => c.vx))
      const maxVx = Math.max(...viewCoords.map((c) => c.vx))
      const minVy = Math.min(...viewCoords.map((c) => c.vy))
      const maxVy = Math.max(...viewCoords.map((c) => c.vy))

      const expMinX = 0.1 * viewport.width
      const expMaxX = 0.4 * viewport.width
      const expMinY = 0.2 * viewport.height
      const expMaxY = 0.3 * viewport.height

      expect(Math.abs(minVx - expMinX)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(maxVx - expMaxX)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(minVy - expMinY)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(maxVy - expMaxY)).toBeLessThanOrEqual(0.05)

      passed++
    }
    expect(passed).toBe(16)
  })

  it('K3: text item is upright in viewport across all 16 matrix M pages', async () => {
    let passed = 0
    for (const cfg of matrix) {
      const baseBytes = await createFixturePdfBytes(cfg)
      const textAnn: Annotation = {
        id: 'ann-text',
        page: 1,
        type: 'text',
        text: 'Test 01',
        fontSize: 12,
        x: 0.2,
        y: 0.3,
        width: 0.3,
        height: 0.05,
        color: '#000000',
        opacity: 1,
        fontFamily: 'Helvetica',
      }

      const exportedBytes = await buildEditedPdf(baseBytes, [textAnn])
      const loaded = await pdfjsLib.getDocument({ data: exportedBytes.slice() }).promise
      const pdfPage = await loaded.getPage(1)
      const viewport = pdfPage.getViewport({ scale: 1 })
      const textContent = await pdfPage.getTextContent()

      const item = textContent.items.find((it) => 'str' in it && it.str === 'Test 01') as
        | { transform: number[]; str: string }
        | undefined
      expect(item).toBeDefined()

      const [t1, t2, t3, t4, t5, t6] = item!.transform
      const [v1, v2, v3, v4, v5] = viewport.transform
      const a = v1 * t1 + v3 * t2
      const b = v2 * t1 + v4 * t2
      const c = v1 * t3 + v3 * t4
      const d = v2 * t3 + v4 * t4
      const e = v1 * t5 + v3 * t6 + v5

      expect(a).toBeGreaterThan(0)
      expect(Math.abs(b)).toBeLessThan(1e-4)
      expect(Math.abs(c)).toBeLessThan(1e-4)
      expect(d).toBeLessThan(0)
      expect(Math.abs(e - 0.2 * viewport.width)).toBeLessThan(0.5)

      passed++
    }
    expect(passed).toBe(16)
  })

  it('K4: image covers visible rect and width is horizontal across all 16 matrix M pages', async () => {
    let passed = 0
    for (const cfg of matrix) {
      const baseBytes = await createFixturePdfBytes(cfg)
      const imgAnn: Annotation = {
        id: 'ann-img',
        page: 1,
        type: 'image',
        x: 0.5,
        y: 0.5,
        width: 0.2,
        height: 0.1,
        color: '#000000',
        opacity: 1,
        imageDataUrl: PNG_2X1,
      }

      const exportedBytes = await buildEditedPdf(baseBytes, [imgAnn], {
        loadImageBytes: defaultLoadImageBytes,
      })
      const loaded = await pdfjsLib.getDocument({ data: exportedBytes.slice() }).promise
      const pdfPage = await loaded.getPage(1)
      const viewport = pdfPage.getViewport({ scale: 1 })

      const doc = await PDFDocument.load(exportedBytes)
      const content = readPageContent(doc, 0)
      const ops = tokenizeContent(content)
      const doIndex = ops.findIndex((o) => o.operator === 'Do')
      expect(doIndex).toBeGreaterThan(0)

      let ctm = [1, 0, 0, 1, 0, 0]
      for (const op of ops.slice(0, doIndex + 1)) {
        if (op.operator === 'cm') {
          const [m1, m2, m3, m4, m5, m6] = op.operands.map((o) => ('value' in o ? (o.value as number) : 0))
          const [a, b, c, d, e, f] = ctm
          ctm = [
            m1 * a + m2 * c,
            m1 * b + m2 * d,
            m3 * a + m4 * c,
            m3 * b + m4 * d,
            m5 * a + m6 * c + e,
            m5 * b + m6 * d + f,
          ]
        }
      }

      const unitCorners = [
        { x: 0, y: 0, label: 'BL' },
        { x: 1, y: 0, label: 'BR' },
        { x: 0, y: 1, label: 'TL' },
        { x: 1, y: 1, label: 'TR' },
      ]

      const viewCorners = unitCorners.map((pt) => {
        const pdfX = pt.x * ctm[0] + pt.y * ctm[2] + ctm[4]
        const pdfY = pt.x * ctm[1] + pt.y * ctm[3] + ctm[5]
        const [vx, vy] = viewport.convertToViewportPoint(pdfX, pdfY)
        return { label: pt.label, vx, vy }
      })

      const tl = viewCorners.find((c) => c.label === 'TL')!
      const tr = viewCorners.find((c) => c.label === 'TR')!
      const bl = viewCorners.find((c) => c.label === 'BL')!
      const br = viewCorners.find((c) => c.label === 'BR')!

      const expLeft = 0.5 * viewport.width
      const expRight = 0.7 * viewport.width
      const expTop = 0.5 * viewport.height
      const expBottom = 0.6 * viewport.height

      expect(Math.abs(tl.vx - expLeft)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(tl.vy - expTop)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(tr.vx - expRight)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(tr.vy - expTop)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(bl.vx - expLeft)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(bl.vy - expBottom)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(br.vx - expRight)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(br.vy - expBottom)).toBeLessThanOrEqual(0.05)

      // Width vector must be horizontal and point rightwards
      expect(Math.abs(tr.vy - tl.vy)).toBeLessThanOrEqual(0.05)
      expect(tr.vx).toBeGreaterThan(tl.vx)

      passed++
    }
    expect(passed).toBe(16)
  })

  it('K5: ink line coordinates match viewport points across all 16 matrix M pages', async () => {
    let passed = 0
    const testPoints = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.2 },
    ]

    for (const cfg of matrix) {
      const baseBytes = await createFixturePdfBytes(cfg)
      const inkAnn: Annotation = {
        id: 'ann-ink',
        page: 1,
        type: 'draw',
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.4,
        color: '#E85D3F',
        opacity: 1,
        points: testPoints,
      }

      const exportedBytes = await buildEditedPdf(baseBytes, [inkAnn])
      const loaded = await pdfjsLib.getDocument({ data: exportedBytes.slice() }).promise
      const pdfPage = await loaded.getPage(1)
      const viewport = pdfPage.getViewport({ scale: 1 })

      const doc = await PDFDocument.load(exportedBytes)
      const content = readPageContent(doc, 0)
      const ops = tokenizeContent(content)

      const lineOps = ops.filter((o) => o.operator === 'm' || o.operator === 'l')
      expect(lineOps.length).toBeGreaterThanOrEqual(2)

      for (let i = 0; i < testPoints.length - 1; i++) {
        const ptExpected = testPoints[i]
        const [vx, vy] = viewport.convertToViewportPoint(
          (lineOps[i * 3].operands[0] as { value: number }).value,
          (lineOps[i * 3].operands[1] as { value: number }).value,
        )
        expect(Math.abs(vx - ptExpected.x * viewport.width)).toBeLessThanOrEqual(0.05)
        expect(Math.abs(vy - ptExpected.y * viewport.height)).toBeLessThanOrEqual(0.05)
      }

      passed++
    }
    expect(passed).toBe(16)
  })

  it('K6: standard page produces exact same content stream operations as before fix', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Customer: Hoc vien Test 01', { x: 50, y: 350, size: 12, font })
    const baseBytes = new Uint8Array(await doc.save())

    const png1x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

    const t6Ann: Annotation = {
      id: 'ann-t6',
      page: 1,
      type: 'text',
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

    const t8Anns: Annotation[] = [
      {
        id: 'ann-hl',
        page: 1,
        type: 'highlight',
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.05,
        color: '#F5C84C',
        opacity: 0.38,
      },
      {
        id: 'ann-ink',
        page: 1,
        type: 'draw',
        x: 0.1,
        y: 0.2,
        width: 0,
        height: 0,
        color: '#E85D3F',
        opacity: 1,
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.2, y: 0.25 },
          { x: 0.3, y: 0.2 },
        ],
      },
      {
        id: 'ann-img',
        page: 1,
        type: 'image',
        x: 0.4,
        y: 0.4,
        width: 0.2,
        height: 0.2,
        color: '#000000',
        opacity: 1,
        imageDataUrl: png1x1,
      },
    ]

    const allAnnotations = [t6Ann, ...t8Anns]

    const exportedBytes = await buildEditedPdf(baseBytes, allAnnotations, {
      loadImageBytes: defaultLoadImageBytes,
    })

    const exportedDoc = await PDFDocument.load(exportedBytes)
    const content = readPageContent(exportedDoc, 0)
    const ops = tokenizeContent(content)

    // Reference operator sequence captured on main (unmodified exportPdf.ts):
    const expectedOperators = [
      'q', 'q', 'BT', 'rg', 'Tf', 'TL', 'Tm', 'Tj', 'T*', 'ET', 'Q', 'Q',
      'q', 'gs', 'rg', 'w', 'd', 'cm', 'cm', 'cm', 'm', 'l', 'l', 'l', 'h', 'f', 'Q',
      'q', 'gs', 'BT', 'rg', 'Tf', 'TL', 'Tm', 'Tj', 'T*', 'ET', 'Q',
      'q', 'gs', 'rg', 'w', 'd', 'cm', 'cm', 'cm', 'm', 'l', 'l', 'l', 'h', 'f', 'Q',
      'q', 'gs', 'RG', 'w', 'd', 'm', 'm', 'l', 'S', 'Q',
      'q', 'gs', 'RG', 'w', 'd', 'm', 'm', 'l', 'S', 'Q',
      'q', 'gs', 'cm', 'cm', 'cm', 'cm', 'Do', 'Q',
    ]

    const actualOperators = ops.map((o) => o.operator)
    expect(actualOperators).toEqual(expectedOperators)

    // Check specific critical coordinates match unmodified export:
    // Mask rectangle: 49.04 345.56 cm
    const maskCm = ops[17]
    expect(maskCm.operator).toBe('cm')
    expect((maskCm.operands[4] as { value: number }).value).toBeCloseTo(49.04, 2)
    expect((maskCm.operands[5] as { value: number }).value).toBeCloseTo(345.56, 2)

    // Highlight rectangle: 60 340 cm
    const hlCm = ops[43]
    expect(hlCm.operator).toBe('cm')
    expect((hlCm.operands[4] as { value: number }).value).toBeCloseTo(60, 2)
    expect((hlCm.operands[5] as { value: number }).value).toBeCloseTo(340, 2)

    // Text position: 50 350 Tm
    const textTm = ops[33]
    expect(textTm.operator).toBe('Tm')
    expect((textTm.operands[4] as { value: number }).value).toBeCloseTo(50, 2)
    expect((textTm.operands[5] as { value: number }).value).toBeCloseTo(350, 2)

    // Image position: 240 160 cm
    // Image block: q gs cm(translate) cm(rotate) cm(scale) cm(skew) Do Q
    const doIndex = ops.findIndex((o) => o.operator === 'Do')
    expect(doIndex).toBeGreaterThan(0)
    const imgCm = ops[doIndex - 4]
    expect(imgCm.operator).toBe('cm')
    expect((imgCm.operands[4] as { value: number }).value).toBeCloseTo(240, 2)
    expect((imgCm.operands[5] as { value: number }).value).toBeCloseTo(160, 2)
  })

  it('K7: throws UNSUPPORTED_ROTATION when page rotation is not a multiple of 90 degrees', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(45))
    const baseBytes = new Uint8Array(await doc.save())

    await expect(
      buildEditedPdf(baseBytes, [
        {
          id: '1',
          page: 1,
          type: 'highlight',
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          color: '#F5C84C',
          opacity: 0.38,
        },
      ]),
    ).rejects.toThrowError(/^UNSUPPORTED_ROTATION:/)
  })
})
