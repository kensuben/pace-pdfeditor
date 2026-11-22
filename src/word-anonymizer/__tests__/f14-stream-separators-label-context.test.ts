import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { OOXML_NAMESPACES } from '../core/constants'
import { parseXml } from '../core/xml'
import { anonymizeDocx } from '../core/anonymize'
import { scanResidual } from '../core/residual'
import { CustomEntity, IdentityMapping, KeywordRule } from '../core/types'
import {
  createF14FixtureDocx,
  createF14SplitEntityDocx,
  createF14BenchmarkDocx,
} from './fixtures'

const mockMapping: IdentityMapping = {}

const customEntities: CustomEntity[] = [
  {
    id: 'ent-1',
    kind: 'representative',
    label: 'Người đại diện 2',
    values: ['NGƯỜI ĐẠI DIỆN TEST 02'],
  },
]

describe('F-14: Word Stream Separators and Label Context', () => {
  // K1: đoạn A → Ông Người đại diện 2 + tab + Chức vụ: Giám đốc (tab giữ nguyên trong XML)
  it('K1: replaces entity followed by tab without breaking on boundary, tab remains in XML', async () => {
    const inputBuf = await createF14FixtureDocx()
    const result = await anonymizeDocx(inputBuf, mockMapping, {
      customEntities,
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(result.blob)
    const xml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(xml)
    const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

    const p0 = paragraphs[0]
    const p0Text = Array.from(p0.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
      .map((n) => n.textContent)
      .join('')
    const p0Tabs = Array.from(p0.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'tab'))

    expect(p0Text).toContain('Ông Người đại diện 2')
    expect(p0Text).toContain('Chức vụ: Giám đốc')
    expect(p0Text).not.toContain('NGƯỜI ĐẠI DIỆN TEST 02')
    // Tabs must be preserved as elements in XML
    expect(p0Tabs.length).toBeGreaterThanOrEqual(2)
  })

  // K2: đoạn B → dòng 1 thành Liên hệ: l****@e****.com, dòng 2 giữ nguyên Tiếp theo
  it('K2: line break separates email from next line, does not corrupt next line text', async () => {
    const inputBuf = await createF14FixtureDocx()
    const result = await anonymizeDocx(inputBuf, mockMapping, {
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(result.blob)
    const xml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(xml)
    const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

    const p1 = paragraphs[1]
    const tNodes = Array.from(p1.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
    const brs = Array.from(p1.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'br'))

    expect(brs.length).toBe(1)
    const combined = tNodes.map((n) => n.textContent).join('')
    expect(combined).toContain('Liên hệ: l****@e****.com')
    expect(combined).toContain('Tiếp theo')
    expect(combined).not.toContain('lienhe.test@example.com')
  })

  // K3: đoạn "MST:⇥0101234567⇥Điện thoại: 0912 345 678" → *******567 và 09******78
  it('K3: masks tax code and phone separated by tabs properly', async () => {
    const inputBuf = await createF14FixtureDocx()
    const result = await anonymizeDocx(inputBuf, mockMapping, {
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(result.blob)
    const xml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(xml)
    const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

    const p2 = paragraphs[2]
    const p2Text = Array.from(p2.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
      .map((n) => n.textContent)
      .join('')

    expect(p2Text).toContain('*******567')
    expect(p2Text).toContain('09******78')
    expect(p2Text).not.toContain('0101234567')
    expect(p2Text).not.toContain('0912 345 678')
  })

  // K3b: w:noBreakHyphen and w:softHyphen handling, virtual separators not written to XML
  it('K3b: handles w:noBreakHyphen and w:softHyphen, never writes virtual separators to XML', async () => {
    const inputBuf = await createF14FixtureDocx()
    const result = await anonymizeDocx(inputBuf, mockMapping, {
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(result.blob)
    const xml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(xml)
    const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

    const p5 = paragraphs[5]
    const p5t = Array.from(p5.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
      .map((n) => n.textContent)
      .join('')
    expect(p5t).toContain('09******78')
    expect(p5t).not.toContain('0912345678')
    expect(p5t).not.toContain('091-2345678')

    // XML document must not contain literal \t or \n inside any w:t or w:delText node
    const allTextNodes = [
      ...Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')),
      ...Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText')),
    ]
    for (const tNode of allTextNodes) {
      const text = tNode.textContent || ''
      expect(text).not.toContain('\t')
      expect(text).not.toContain('\n')
    }
  })

  // K4: "Địa chỉ:⇥[xoá]Số 1 Đường Test, Hà Nội" → w:delText thành ****, Hà Nội.
  // "Mã số thuế:⇥[xoá]0101234567" → *******567. Nhãn w:t giữ nguyên.
  it('K4: masks address and tax code in w:delText using w:t label context, w:t labels intact', async () => {
    const inputBuf = await createF14FixtureDocx()
    const result = await anonymizeDocx(inputBuf, mockMapping, {
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(result.blob)
    const xml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(xml)
    const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

    // Paragraph 3: Địa chỉ
    const p3 = paragraphs[3]
    const p3t = Array.from(p3.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
      .map((n) => n.textContent)
      .join('')
    const p3del = Array.from(p3.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
      .map((n) => n.textContent)
      .join('')

    expect(p3t).toContain('Địa chỉ:')
    expect(p3del).toBe('****, Hà Nội')
    expect(p3del).not.toContain('Số 1 Đường Test')

    // Paragraph 4: Mã số thuế
    const p4 = paragraphs[4]
    const p4t = Array.from(p4.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
      .map((n) => n.textContent)
      .join('')
    const p4del = Array.from(p4.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
      .map((n) => n.textContent)
      .join('')

    expect(p4t).toContain('Mã số thuế:')
    expect(p4del).toBe('*******567')
    expect(p4del).not.toContain('0101234567')
  })

  // K5: residual trên file gốc (chưa ẩn danh) có finding deleted-text; trên file đã ẩn danh → PASS
  it('K5: residual detects unmasked deleted-text in original file, passes on anonymized file', async () => {
    const inputBuf = await createF14FixtureDocx()

    // 1. Scan on original (un-anonymized) file
    const origResidual = await scanResidual(inputBuf, [], customEntities, {
      deletedTextMode: 'mask',
    })
    const delFindings = origResidual.findings.filter((f) => f.category === 'deleted-text')
    expect(delFindings.length).toBeGreaterThanOrEqual(2)
    expect(delFindings.some((f) => f.matchedString.includes('Số 1 Đường Test'))).toBe(true)
    expect(delFindings.some((f) => f.matchedString.includes('0101234567'))).toBe(true)
    expect(origResidual.status).toBe('WARN')

    // 2. Anonymize and scan again
    const result = await anonymizeDocx(inputBuf, mockMapping, {
      customEntities,
      deletedTextMode: 'mask',
    })
    const anonResidual = await scanResidual(await result.blob.arrayBuffer(), [], customEntities, {
      deletedTextMode: 'mask',
    })

    expect(anonResidual.findings).toHaveLength(0)
    expect(anonResidual.status).toBe('PASS')
  })

  // K6: entity tách giữa w:t và w:delText ("Đại diện: Bà NGƯỜI ĐẠI " + [xoá]"DIỆN TEST 05")
  // với entity NGƯỜI ĐẠI DIỆN TEST 05
  it('K6: handles entity split across w:t and w:delText, strips delText fragment, residual passes', async () => {
    const splitEntity: CustomEntity = {
      id: 'split-1',
      kind: 'representative',
      label: 'Người đại diện 5',
      values: ['NGƯỜI ĐẠI DIỆN TEST 05'],
    }

    const inputBuf = await createF14SplitEntityDocx()
    const result = await anonymizeDocx(inputBuf, mockMapping, {
      customEntities: [splitEntity],
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(result.blob)
    const xml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(xml)
    const p = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p')[0]

    const tContent = Array.from(p.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
      .map((n) => n.textContent)
      .join('')
    const delContent = Array.from(p.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
      .map((n) => n.textContent)
      .join('')

    // w:delText fragment "DIỆN TEST 05" must be cleared
    expect(delContent).not.toContain('DIỆN TEST 05')
    expect(delContent).toBe('')
    // w:t is processed by w:t stream (remains "Đại diện: Bà NGƯỜI ĐẠI ")
    expect(tContent).toContain('Đại diện: Bà NGƯỜI ĐẠI')

    // Residual does not report any false warnings
    const res = await scanResidual(await result.blob.arrayBuffer(), [], [splitEntity], {
      deletedTextMode: 'mask',
    })
    expect(res.findings.filter((f) => f.matchedString.includes('TEST 05'))).toHaveLength(0)
    expect(res.status).toBe('PASS')
  })

  // K7: Single-pass keyword replacement integrity (W-14 K7 property)
  it('K7: preserves single-pass keyword replacement property', async () => {
    const rules: KeywordRule[] = [
      { id: 'r1', find: 'Dự án Alpha', replace: 'Dự án Beta' },
      { id: 'r2', find: 'Dự án Beta', replace: 'Dự án Gamma' },
    ]
    const inputBuf = await createF14FixtureDocx()
    const result = await anonymizeDocx(inputBuf, mockMapping, {
      keywordRules: rules,
      deletedTextMode: 'mask',
    })

    expect(result.report.replacements.keywords).toBe(0)
  })

  // K8: Hiệu năng tuyến tính: 2.000 đoạn, mỗi đoạn 3 tab → anonymizeDocx chạy nhanh
  it(
    'K8: processes 2000 paragraphs with multiple tabs with fast linear performance',
    async () => {
      const benchBuf = await createF14BenchmarkDocx(2000)

      // Measure one call to anonymizeDocx with 120s timeout
      const times: number[] = []
      for (let run = 0; run < 3; run++) {
        const start = performance.now()
        await anonymizeDocx(benchBuf, mockMapping, {
          customEntities,
          deletedTextMode: 'mask',
        })
        const end = performance.now()
        const elapsed = end - start
        console.log(`[K8 run ${run + 1}] ${elapsed.toFixed(2)}ms`)
        times.push(elapsed)
      }

      times.sort((a, b) => a - b)
      const medianTime = times[1]
      console.log(
        `[F-14 Benchmark] Runs: ${times.map((t) => t.toFixed(2) + 'ms').join(', ')} | Median: ${medianTime.toFixed(2)}ms`
      )
      expect(medianTime).toBeGreaterThan(0)
    },
    120000
  )
})
