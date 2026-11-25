// @vitest-environment jsdom
if (typeof DOMMatrix === 'undefined') {
  // @ts-expect-error polyfill for jsdom
  globalThis.DOMMatrix = class DOMMatrix {}
}
// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import type { Annotation } from '../../types'
import { buildEditedPdfWithReport, probePageImages } from '../index'

const TINY_PNG_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const TINY_PNG_REPLACE_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACanAg4P3mDkAAAAAElFTkSuQmCC'

const TINY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

describe('W-10b2: Page Contents array preservation after stream rewrite', () => {
  async function createBasePdfWithImageAndText(): Promise<{ bytes: Uint8Array; imageResName: string }> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const png = await doc.embedPng(TINY_PNG_BYTES)
    page.drawImage(png, { x: 50, y: 250, width: 100, height: 80 })
    page.drawText('Original Line to Replace', { x: 50, y: 150, size: 14 })
    const bytes = new Uint8Array(await doc.save())

    const checkDoc = await PDFDocument.load(bytes)
    const probed = probePageImages(checkDoc, 0)
    expect(probed.images.length).toBe(1)
    const imageResName = probed.images[0].resourceName

    return { bytes, imageResName }
  }

  // (a) thay ảnh có sẵn + 1 highlight
  it('(a) replaces existing image + adds 1 highlight on the same page', async () => {
    const { bytes: baseBytes, imageResName } = await createBasePdfWithImageAndText()

    const annotations: Annotation[] = [
      {
        id: 'replace-img',
        page: 1,
        type: 'image',
        x: 50 / 600,
        y: (400 - 250 - 80) / 400,
        width: 100 / 600,
        height: 80 / 400,
        color: '#000000',
        opacity: 1,
        replacementDataUrl: TINY_PNG_REPLACE_DATAURL,
        sourceImage: {
          resourceName: imageResName,
          occurrence: 0,
          originalRect: {
            x: 50 / 600,
            y: (400 - 250 - 80) / 400,
            width: 100 / 600,
            height: 80 / 400,
          },
        },
      },
      {
        id: 'hl-1',
        page: 1,
        type: 'highlight',
        x: 0.2,
        y: 0.6,
        width: 0.4,
        height: 0.05,
        color: '#ffeb3b',
        opacity: 0.4,
      },
    ]

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, annotations)
    expect(outBytes.length).toBeGreaterThan(0)

    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    // Expect paintImageXObject (for the replaced image) and constructPath / rectangle (for highlight)
    expect(opList.fnArray.includes(pdfjsLib.OPS.paintImageXObject)).toBe(true)
    expect(
      opList.fnArray.includes(pdfjsLib.OPS.rectangle) ||
      opList.fnArray.includes(pdfjsLib.OPS.constructPath),
    ).toBe(true)
  })

  // (b) thay ảnh có sẵn + 1 ảnh chèn lật ngang
  it('(b) replaces existing image + adds 1 inserted image with flipH on the same page', async () => {
    const { bytes: baseBytes, imageResName } = await createBasePdfWithImageAndText()

    const annotations: Annotation[] = [
      {
        id: 'replace-img',
        page: 1,
        type: 'image',
        x: 50 / 600,
        y: (400 - 250 - 80) / 400,
        width: 100 / 600,
        height: 80 / 400,
        color: '#000000',
        opacity: 1,
        replacementDataUrl: TINY_PNG_REPLACE_DATAURL,
        sourceImage: {
          resourceName: imageResName,
          occurrence: 0,
          originalRect: {
            x: 50 / 600,
            y: (400 - 250 - 80) / 400,
            width: 100 / 600,
            height: 80 / 400,
          },
        },
      },
      {
        id: 'ins-fliph',
        page: 1,
        type: 'image',
        x: 0.3,
        y: 0.5,
        width: 0.2,
        height: 0.15,
        color: '#000000',
        opacity: 0.9,
        flipH: true,
        imageDataUrl: TINY_PNG_DATAURL,
      },
    ]

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, annotations)
    expect(outBytes.length).toBeGreaterThan(0)

    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    // Expect 2 paintImageXObject occurrences (1 existing replaced + 1 newly inserted)
    const paintCount = opList.fnArray.filter((fn) => fn === pdfjsLib.OPS.paintImageXObject).length
    expect(paintCount).toBe(2)
  })

  // (c) thay ảnh có sẵn + 1 text box mới
  it('(c) replaces existing image + adds 1 new text box on the same page', async () => {
    const { bytes: baseBytes, imageResName } = await createBasePdfWithImageAndText()

    const annotations: Annotation[] = [
      {
        id: 'replace-img',
        page: 1,
        type: 'image',
        x: 50 / 600,
        y: (400 - 250 - 80) / 400,
        width: 100 / 600,
        height: 80 / 400,
        color: '#000000',
        opacity: 1,
        replacementDataUrl: TINY_PNG_REPLACE_DATAURL,
        sourceImage: {
          resourceName: imageResName,
          occurrence: 0,
          originalRect: {
            x: 50 / 600,
            y: (400 - 250 - 80) / 400,
            width: 100 / 600,
            height: 80 / 400,
          },
        },
      },
      {
        id: 'new-text',
        page: 1,
        type: 'text',
        text: 'Newly Inserted Text Box',
        x: 0.1,
        y: 0.7,
        width: 0.4,
        height: 0.08,
        fontSize: 14,
        fontFamily: 'Helvetica',
        color: '#ff0000',
        opacity: 1,
      },
    ]

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, annotations)
    expect(outBytes.length).toBeGreaterThan(0)

    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    expect(opList.fnArray.includes(pdfjsLib.OPS.paintImageXObject)).toBe(true)
    expect(opList.fnArray.includes(pdfjsLib.OPS.showText)).toBe(true)

    const textContent = await p1.getTextContent()
    const strings = textContent.items.map((it: unknown) =>
      'str' in (it as { str: string }) ? (it as { str: string }).str : '',
    )
    expect(strings.some((s) => s.includes('Newly Inserted Text Box'))).toBe(true)
  })

  // (d) sửa chữ có sẵn (W-9a, replaceOriginal) + xoay ảnh có sẵn
  it('(d) edits existing text (replaceOriginal) + rotates existing image on the same page', async () => {
    const { bytes: baseBytes, imageResName } = await createBasePdfWithImageAndText()

    const annotations: Annotation[] = [
      {
        id: 'rotate-img',
        page: 1,
        type: 'image',
        x: 50 / 600,
        y: (400 - 250 - 80) / 400,
        width: 100 / 600,
        height: 80 / 400,
        color: '#000000',
        opacity: 1,
        imageRotation: 90,
        sourceImage: {
          resourceName: imageResName,
          occurrence: 0,
          originalRect: {
            x: 50 / 600,
            y: (400 - 250 - 80) / 400,
            width: 100 / 600,
            height: 80 / 400,
          },
        },
      },
      {
        id: 'replace-orig-text',
        page: 1,
        type: 'text',
        text: 'Replaced Text Content',
        x: 50 / 600,
        y: (400 - 150 - 14) / 400,
        width: 250 / 600,
        height: 20 / 400,
        fontSize: 14,
        fontFamily: 'Helvetica',
        color: '#000000',
        opacity: 1,
        replaceOriginal: true,
        backgroundColor: '#ffffff',
      },
    ]

    const { bytes: outBytes, report } = await buildEditedPdfWithReport(baseBytes, annotations)
    expect(outBytes.length).toBeGreaterThan(0)
    expect(report.cleanedPages).toContain(1)

    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    expect(opList.fnArray.includes(pdfjsLib.OPS.paintImageXObject)).toBe(true)
    expect(opList.fnArray.includes(pdfjsLib.OPS.showText)).toBe(true)

    const textContent = await p1.getTextContent()
    const strings = textContent.items.map((it: unknown) =>
      'str' in (it as { str: string }) ? (it as { str: string }).str : '',
    )
    expect(strings.some((s) => s.includes('Replaced Text Content'))).toBe(true)
    expect(strings.some((s) => s.includes('Original Line to Replace'))).toBe(false)
  })

  // (e) xoá ảnh có sẵn + 1 highlight
  it('(e) deletes existing image + adds 1 highlight on the same page', async () => {
    const { bytes: baseBytes, imageResName } = await createBasePdfWithImageAndText()

    const annotations: Annotation[] = [
      {
        id: 'del-img',
        page: 1,
        type: 'image',
        x: 50 / 600,
        y: (400 - 250 - 80) / 400,
        width: 100 / 600,
        height: 80 / 400,
        color: '#000000',
        opacity: 1,
        deleted: true,
        sourceImage: {
          resourceName: imageResName,
          occurrence: 0,
          originalRect: {
            x: 50 / 600,
            y: (400 - 250 - 80) / 400,
            width: 100 / 600,
            height: 80 / 400,
          },
        },
      },
      {
        id: 'hl-after-del',
        page: 1,
        type: 'highlight',
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.05,
        color: '#00ff00',
        opacity: 0.35,
      },
    ]

    const { bytes: outBytes } = await buildEditedPdfWithReport(baseBytes, annotations)
    expect(outBytes.length).toBeGreaterThan(0)

    const pdfjsDoc = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise
    const p1 = await pdfjsDoc.getPage(1)
    const opList = await p1.getOperatorList()

    // Deleted image means NO paintImageXObject
    expect(opList.fnArray.includes(pdfjsLib.OPS.paintImageXObject)).toBe(false)
    // Highlight exists
    expect(
      opList.fnArray.includes(pdfjsLib.OPS.rectangle) ||
      opList.fnArray.includes(pdfjsLib.OPS.constructPath),
    ).toBe(true)
  })
})
