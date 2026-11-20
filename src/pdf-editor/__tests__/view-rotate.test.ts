// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { rotatePage } from '../pageOps'

describe('rotatePage Unit Test (W-11 K5)', () => {
  it('K5: rotates page 1 clockwise by 90 degrees while leaving page 2 at 0, returns to 0 after 4 rotations', async () => {
    // Create a 2-page PDF fixture
    const doc = await PDFDocument.create()
    doc.addPage([600, 400])
    doc.addPage([500, 700])
    const initialBytes = new Uint8Array(await doc.save())

    // 1st rotation on page 1 (index 0)
    const rot1Bytes = await rotatePage(initialBytes, 0, 90)
    const doc1 = await PDFDocument.load(rot1Bytes)
    expect(doc1.getPage(0).getRotation().angle).toBe(90)
    expect(doc1.getPage(1).getRotation().angle).toBe(0)

    // 2nd rotation on page 1
    const rot2Bytes = await rotatePage(rot1Bytes, 0, 90)
    const doc2 = await PDFDocument.load(rot2Bytes)
    expect(doc2.getPage(0).getRotation().angle).toBe(180)
    expect(doc2.getPage(1).getRotation().angle).toBe(0)

    // 3rd rotation on page 1
    const rot3Bytes = await rotatePage(rot2Bytes, 0, 90)
    const doc3 = await PDFDocument.load(rot3Bytes)
    expect(doc3.getPage(0).getRotation().angle).toBe(270)
    expect(doc3.getPage(1).getRotation().angle).toBe(0)

    // 4th rotation on page 1 -> returns to 0 (or 360)
    const rot4Bytes = await rotatePage(rot3Bytes, 0, 90)
    const doc4 = await PDFDocument.load(rot4Bytes)
    const finalAngle = doc4.getPage(0).getRotation().angle
    expect(finalAngle % 360).toBe(0)
    expect(doc4.getPage(1).getRotation().angle).toBe(0)
  })
})
