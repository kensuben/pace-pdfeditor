// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

import {
  tokenizeContent,
  serializeContent,
  ContentSyntaxError,
} from '../engine/contentTokenizer'
import { readPageContent, writePageContent } from '../engine/pageContent'
import { removeTextInRegions } from '../engine/textRemoval'
import type { Rect } from '../engine/types'

const require = createRequire(import.meta.url)
const pdfjsPkgPath = require.resolve('pdfjs-dist/package.json')
const standardFontDataUrl = path.join(path.dirname(pdfjsPkgPath), 'standard_fonts').replace(/\\/g, '/') + '/'
const beVietnamProPath = fileURLToPath(new URL('../fonts/BeVietnamPro-Regular.ttf', import.meta.url))

async function extractTextLines(pdfBytes: Uint8Array): Promise<Array<{ str: string; x: number; y: number }>> {
  const doc = await pdfjsLib.getDocument({
    data: pdfBytes.slice(),
    standardFontDataUrl,
  }).promise
  const page = await doc.getPage(1)
  const content = await page.getTextContent()
  const lines: Array<{ str: string; x: number; y: number }> = []
  for (const item of content.items) {
    if ('str' in item && 'transform' in item && Array.isArray(item.transform)) {
      lines.push({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
      })
    }
  }
  return lines
}

async function extractFullText(pdfBytes: Uint8Array): Promise<string> {
  const items = await extractTextLines(pdfBytes)
  return items.map((i) => i.str).join(' ')
}

describe('W-7 Content Stream Engine Spike Tests', () => {
  // =========================================================================
  // K1: Tokenizer Round-trip
  // =========================================================================
  it('K1: tokenizer round-trip achieves identity on all required patterns', async () => {
    // 1. Literal string with \(, \), \\, \053, and nested parentheses
    const literalSample = new TextEncoder().encode('(hello \\(world\\) \\\\ \\053 (nested)) Tj\n')
    const litOps = tokenizeContent(literalSample)
    const litSer = serializeContent(litOps)
    expect(tokenizeContent(litSer)).toEqual(litOps)

    // 2. Hex string with odd number of digits
    const hexSample = new TextEncoder().encode('<123> Tj\n')
    const hexOps = tokenizeContent(hexSample)
    const hexSer = serializeContent(hexOps)
    expect(tokenizeContent(hexSer)).toEqual(hexOps)

    // 3. Name with #20 escape (/A#20B)
    const nameSample = new TextEncoder().encode('/A#20B 12 Tf\n')
    const nameOps = tokenizeContent(nameSample)
    const nameSer = serializeContent(nameOps)
    expect(tokenizeContent(nameSer)).toEqual(nameOps)

    // 4. Dictionary with BDC
    const dictSample = new TextEncoder().encode('/Span << /MCID 1 >> BDC\n')
    const dictOps = tokenizeContent(dictSample)
    const dictSer = serializeContent(dictOps)
    expect(tokenizeContent(dictSer)).toEqual(dictOps)

    // 5. Inline image BI ... ID <binary data> EI
    const imgSample = new Uint8Array([
      ...new TextEncoder().encode('BI /W 2 /H 2 /BPC 8 /CS /G ID '),
      0x01, 0x02, 0x03, 0x04,
      ...new TextEncoder().encode(' EI\n'),
    ])
    const imgOps = tokenizeContent(imgSample)
    const imgSer = serializeContent(imgOps)
    expect(tokenizeContent(imgSer)).toEqual(imgOps)

    // 6. Comments
    const commentSample = new TextEncoder().encode('% Header comment\nq\n% Middle comment\nQ\n')
    const commentOps = tokenizeContent(commentSample)
    const commentSer = serializeContent(commentOps)
    expect(tokenizeContent(commentSer)).toEqual(commentOps)

    // 7. Page rewritten with writePageContent preserves exact pdf.js getTextContent
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Sample Line One', { x: 50, y: 350, font, size: 14 })
    page.drawText('Sample Line Two', { x: 50, y: 320, font, size: 14 })
    const origPdfBytes = new Uint8Array(await doc.save())

    const origText = await extractFullText(origPdfBytes)

    const loaded = await PDFDocument.load(origPdfBytes)
    const rawContent = readPageContent(loaded, 0)
    const ops = tokenizeContent(rawContent)
    const serialized = serializeContent(ops)
    writePageContent(loaded, 0, serialized)
    const roundTripPdfBytes = new Uint8Array(await loaded.save())

    const roundTripText = await extractFullText(roundTripPdfBytes)
    expect(roundTripText).toBe(origText)
  })

  // =========================================================================
  // K2: Error handling on malformed syntax
  // =========================================================================
  it('K2: malformed syntax throws ContentSyntaxError fast without hanging', () => {
    const unclosedLiteral = new TextEncoder().encode('(unclosed literal string')
    const start1 = performance.now()
    expect(() => tokenizeContent(unclosedLiteral)).toThrow(ContentSyntaxError)
    expect(performance.now() - start1).toBeLessThan(50)

    const unclosedHex = new TextEncoder().encode('<1234')
    const start2 = performance.now()
    expect(() => tokenizeContent(unclosedHex)).toThrow(ContentSyntaxError)
    expect(performance.now() - start2).toBeLessThan(50)

    const unclosedArray = new TextEncoder().encode('[ 1 2 3')
    const start3 = performance.now()
    expect(() => tokenizeContent(unclosedArray)).toThrow(ContentSyntaxError)
    expect(performance.now() - start3).toBeLessThan(50)

    const unclosedDict = new TextEncoder().encode('<< /Key 123')
    const start4 = performance.now()
    expect(() => tokenizeContent(unclosedDict)).toThrow(ContentSyntaxError)
    expect(performance.now() - start4).toBeLessThan(50)
  })

  // =========================================================================
  // K3: Fixture F1 (Standard drawText removal and coordinate preservation)
  // =========================================================================
  it('K3: removes target line in region and preserves other lines coordinates within <= 0.01 pt', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 500])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText('Line A', { x: 50, y: 400, font, size: 12 })
    page.drawText('Customer: Hoc vien Test 01', { x: 50, y: 350, font, size: 12 })
    page.drawText('Line C', { x: 50, y: 300, font, size: 12 })
    const baseBytes = new Uint8Array(await doc.save())

    const beforeLines = await extractTextLines(baseBytes)
    const lineA_before = beforeLines.find((l) => l.str === 'Line A')!
    const lineC_before = beforeLines.find((l) => l.str === 'Line C')!

    const loaded = await PDFDocument.load(baseBytes)
    const regionToRemove: Rect = { x: 40, y: 340, width: 250, height: 25 }
    const report = removeTextInRegions(loaded, 0, [regionToRemove])

    expect(report.removedOps).toBe(1)
    const afterBytes = new Uint8Array(await loaded.save())
    const afterLines = await extractTextLines(afterBytes)

    expect(afterLines.some((l) => l.str.includes('Hoc vien Test 01'))).toBe(false)

    const lineA_after = afterLines.find((l) => l.str === 'Line A')!
    const lineC_after = afterLines.find((l) => l.str === 'Line C')!

    expect(lineA_after).toBeDefined()
    expect(lineC_after).toBeDefined()

    expect(Math.abs(lineA_after.x - lineA_before.x)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(lineA_after.y - lineA_before.y)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(lineC_after.x - lineC_before.x)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(lineC_after.y - lineC_before.y)).toBeLessThanOrEqual(0.01)
  })

  // =========================================================================
  // K4: Fixture F2 (Handwritten Td / T* / ' line advance preservation)
  // =========================================================================
  it('K4: deletes middle line among lines chained with T* and apostrophe preserving subsequent coordinates', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 500])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    // Handcraft content stream using TL, T*, and '
    const streamText = [
      'BT',
      `/${font.name} 12 Tf`,
      '20 TL',
      '1 0 0 1 50 400 Tm',
      '(Line 1) Tj',
      'T*',
      '(Line 2 To Delete) Tj',
      'T*',
      '(Line 3 After) Tj',
      '(Line 4 Apostrophe) \'',
      'ET',
    ].join('\n')

    const flate = doc.context.flateStream(streamText)
    const ref = doc.context.register(flate)
    page.node.set(PDFName.of('Contents'), ref)
    const baseBytes = new Uint8Array(await doc.save())

    const beforeLines = await extractTextLines(baseBytes)
    const line3_before = beforeLines.find((l) => l.str === 'Line 3 After')!
    const line4_before = beforeLines.find((l) => l.str === 'Line 4 Apostrophe')!

    const loaded = await PDFDocument.load(baseBytes)
    // Line 2 baseline is at 400 - 20 = 380
    const regionToRemove: Rect = { x: 40, y: 370, width: 200, height: 25 }
    const report = removeTextInRegions(loaded, 0, [regionToRemove])
    expect(report.removedOps).toBe(1)

    const afterBytes = new Uint8Array(await loaded.save())
    const afterLines = await extractTextLines(afterBytes)

    expect(afterLines.some((l) => l.str.includes('Line 2 To Delete'))).toBe(false)

    const line3_after = afterLines.find((l) => l.str === 'Line 3 After')!
    const line4_after = afterLines.find((l) => l.str === 'Line 4 Apostrophe')!

    expect(line3_after).toBeDefined()
    expect(line4_after).toBeDefined()

    expect(Math.abs(line3_after.x - line3_before.x)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(line3_after.y - line3_before.y)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(line4_after.x - line4_before.x)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(line4_after.y - line4_before.y)).toBeLessThanOrEqual(0.01)
  })

  // =========================================================================
  // K5: Fixture F3 (Scaled CTM q 2 0 0 2 0 0 cm)
  // =========================================================================
  it('K5: correctly evaluates scaled CTM in page coordinates and deletes only inside text', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    const streamText = [
      'q',
      '2 0 0 2 0 0 cm',
      'BT',
      `/${font.name} 12 Tf`,
      '1 0 0 1 50 100 Tm',
      '(Scaled Inside) Tj',
      '1 0 0 1 50 300 Tm',
      '(Scaled Outside) Tj',
      'ET',
      'Q',
    ].join('\n')

    const flate = doc.context.flateStream(streamText)
    const ref = doc.context.register(flate)
    page.node.set(PDFName.of('Contents'), ref)
    const baseBytes = new Uint8Array(await doc.save())

    const loaded = await PDFDocument.load(baseBytes)
    // Inside text in page coordinates has baseline at 100 * 2 = 200, x = 50 * 2 = 100
    // Outside text has baseline at 300 * 2 = 600, x = 100
    const region: Rect = { x: 80, y: 180, width: 200, height: 50 }
    const report = removeTextInRegions(loaded, 0, [region])

    expect(report.removedOps).toBe(1)

    const afterBytes = new Uint8Array(await loaded.save())
    const text = await extractFullText(afterBytes)

    expect(text).not.toContain('Scaled Inside')
    expect(text).toContain('Scaled Outside')
  })

  // =========================================================================
  // K6: Fixture F4 (Type0 Identity-H Vietnamese text removal)
  // =========================================================================
  it('K6: deletes Vietnamese text embedded as Type0 Identity-H with approximate === false', async () => {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const fontBytes = fs.readFileSync(beVietnamProPath)
    const font = await doc.embedFont(fontBytes, { subset: true })

    const page = doc.addPage([600, 400])
    page.drawText('Học viên Test 01', { x: 50, y: 350, font, size: 14 })
    page.drawText('Giữ lại dòng này', { x: 50, y: 250, font, size: 14 })
    const baseBytes = new Uint8Array(await doc.save())

    const loaded = await PDFDocument.load(baseBytes)
    const region: Rect = { x: 40, y: 330, width: 250, height: 40 }
    const report = removeTextInRegions(loaded, 0, [region])

    expect(report.removedOps).toBe(1)
    expect(report.approximateOps).toBe(0)

    const afterBytes = new Uint8Array(await loaded.save())
    const text = await extractFullText(afterBytes)

    expect(text).not.toContain('Học viên Test 01')
    expect(text).toContain('Giữ lại dòng này')
  })

  // =========================================================================
  // K7: Fixture F5 (Table borders preserved without affecting drawing operators)
  // =========================================================================
  it('K7: deletes text inside table cell while preserving all border drawing operators exactly', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    // Draw 2 adjacent table cells with borders
    page.drawRectangle({ x: 50, y: 150, width: 120, height: 60, borderWidth: 1 })
    page.drawRectangle({ x: 170, y: 150, width: 120, height: 60, borderWidth: 1 })
    page.drawText('Cell 1', { x: 65, y: 175, font, size: 12 })
    page.drawText('Cell 2', { x: 185, y: 175, font, size: 12 })
    const baseBytes = new Uint8Array(await doc.save())

    const pDocBefore = await pdfjsLib.getDocument({ data: baseBytes.slice(), standardFontDataUrl }).promise
    const pPageBefore = await pDocBefore.getPage(1)
    const opListBefore = await pPageBefore.getOperatorList()
    // Drawing operations (constructPath / stroke / rectangle) count
    const drawingOpsBefore = opListBefore.fnArray.filter(
      (fn) => fn === pdfjsLib.OPS.constructPath || fn === pdfjsLib.OPS.stroke || fn === pdfjsLib.OPS.rectangle,
    ).length

    const loaded = await PDFDocument.load(baseBytes)
    const cell1Region: Rect = { x: 55, y: 165, width: 100, height: 30 }
    const report = removeTextInRegions(loaded, 0, [cell1Region])
    expect(report.removedOps).toBe(1)

    const afterBytes = new Uint8Array(await loaded.save())
    const pDocAfter = await pdfjsLib.getDocument({ data: afterBytes.slice(), standardFontDataUrl }).promise
    const pPageAfter = await pDocAfter.getPage(1)
    const opListAfter = await pPageAfter.getOperatorList()
    const drawingOpsAfter = opListAfter.fnArray.filter(
      (fn) => fn === pdfjsLib.OPS.constructPath || fn === pdfjsLib.OPS.stroke || fn === pdfjsLib.OPS.rectangle,
    ).length

    expect(drawingOpsAfter).toBe(drawingOpsBefore)

    const text = await extractFullText(afterBytes)
    expect(text).not.toContain('Cell 1')
    expect(text).toContain('Cell 2')
  })

  // =========================================================================
  // K8: Fixture F6 (Form XObject containing text inside region)
  // =========================================================================
  it('K8: skips Form XObject intersecting region without crash and retains text in output', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    const formStream = doc.context.flateStream(`q BT /${font.name} 12 Tf 50 50 Td (Form Text) Tj ET Q`)
    formStream.dict.set(PDFName.of('Type'), PDFName.of('XObject'))
    formStream.dict.set(PDFName.of('Subtype'), PDFName.of('Form'))
    formStream.dict.set(PDFName.of('BBox'), doc.context.obj([0, 0, 200, 200]))
    const formRef = doc.context.register(formStream)

    const res = page.node.Resources()
    if (!res) throw new Error('Page resources missing')
    const existingXobj = res.lookup(PDFName.of('XObject'))
    let xobjDict: PDFDict
    if (existingXobj instanceof PDFDict) {
      xobjDict = existingXobj
    } else {
      xobjDict = doc.context.obj({})
      res.set(PDFName.of('XObject'), xobjDict)
    }
    xobjDict.set(PDFName.of('Fm1'), formRef)

    const pageStream = doc.context.flateStream('/Fm1 Do')
    const pageRef = doc.context.register(pageStream)
    page.node.set(PDFName.of('Contents'), pageRef)
    const baseBytes = new Uint8Array(await doc.save())

    const loaded = await PDFDocument.load(baseBytes)
    const region: Rect = { x: 20, y: 20, width: 100, height: 100 }
    const report = removeTextInRegions(loaded, 0, [region])

    const formSkip = report.skipped.find((s) => s.reason === 'form-xobject')
    expect(formSkip).toBeDefined()
    expect(formSkip!.count).toBe(1)

    const afterBytes = new Uint8Array(await loaded.save())
    const text = await extractFullText(afterBytes)
    expect(text).toContain('Form Text')
  })

  // =========================================================================
  // K9: Fixture F7 (Level 2 Extension: Partial TJ removal)
  // =========================================================================
  it('K9: partial removal in TJ keeps prefix Name: and removes name value', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 400])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    const streamText = [
      'BT',
      `/${font.name} 12 Tf`,
      '1 0 0 1 50 350 Tm',
      '[(Name: ) -20 (Hoc vien Test 01)] TJ',
      'ET',
    ].join('\n')

    const flate = doc.context.flateStream(streamText)
    const ref = doc.context.register(flate)
    page.node.set(PDFName.of('Contents'), ref)
    const baseBytes = new Uint8Array(await doc.save())

    const beforeLines = await extractTextLines(baseBytes)
    const nameLine_before = beforeLines.find((l) => l.str.includes('Name:'))

    const loaded = await PDFDocument.load(baseBytes)
    // 'Name: ' width is ~36 pt. Name starts at 50 + 36 = 86 pt.
    // Region covers only 'Hoc vien Test 01' at x >= 85
    const region: Rect = { x: 85, y: 340, width: 200, height: 25 }
    const report = removeTextInRegions(loaded, 0, [region])

    expect(report.partialOps).toBe(1)

    const afterBytes = new Uint8Array(await loaded.save())
    const afterLines = await extractTextLines(afterBytes)

    const text = afterLines.map((l) => l.str).join(' ')
    expect(text).toContain('Name:')
    expect(text).not.toContain('Hoc vien Test 01')

    if (nameLine_before) {
      const nameLine_after = afterLines.find((l) => l.str.includes('Name:'))!
      expect(Math.abs(nameLine_after.x - nameLine_before.x)).toBeLessThanOrEqual(0.01)
      expect(Math.abs(nameLine_after.y - nameLine_before.y)).toBeLessThanOrEqual(0.01)
    }
  })

  // =========================================================================
  // K10: Performance Benchmark (5,000 Tj ops, 100 regions < 300 ms)
  // =========================================================================
  it('K10: executes < 300ms on 5,000 Tj operators with 100 regions (median of 3 runs)', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([1000, 2000])
    const font = await doc.embedFont(StandardFonts.Helvetica)

    const lines: string[] = ['BT', `/${font.name} 10 Tf`, '12 TL']
    for (let i = 0; i < 5000; i++) {
      const x = (i % 50) * 18 + 20
      const y = Math.floor(i / 50) * 15 + 20
      lines.push(`1 0 0 1 ${x} ${y} Tm`)
      lines.push(`(Item ${i}) Tj`)
    }
    lines.push('ET')

    const flate = doc.context.flateStream(lines.join('\n'))
    const ref = doc.context.register(flate)
    page.node.set(PDFName.of('Contents'), ref)
    const baseBytes = new Uint8Array(await doc.save())

    const regions100: Rect[] = []
    for (let i = 0; i < 100; i++) {
      regions100.push({
        x: (i % 10) * 80 + 30,
        y: Math.floor(i / 10) * 150 + 50,
        width: 60,
        height: 25,
      })
    }

    // Warm-up run
    const warmDoc = await PDFDocument.load(baseBytes)
    removeTextInRegions(warmDoc, 0, regions100)

    // 3 measurement runs
    const measurements: number[] = []
    for (let r = 0; r < 3; r++) {
      const testDoc = await PDFDocument.load(baseBytes)
      const t0 = performance.now()
      removeTextInRegions(testDoc, 0, regions100)
      const t1 = performance.now()
      measurements.push(t1 - t0)
    }

    measurements.sort((a, b) => a - b)
    const median = measurements[1]
    console.log(`[K10 Benchmark] Measurements: ${measurements.map((m) => m.toFixed(2)).join(', ')} ms. Median: ${median.toFixed(2)} ms`)

    expect(median).toBeLessThan(300)
  })
})
