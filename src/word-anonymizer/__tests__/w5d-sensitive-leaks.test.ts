import { describe, it, expect } from 'vitest'
import { findSensitive } from '../core/sensitive'
import { anonymizeDocx } from '../core/anonymize'
import { scanResidual } from '../core/residual'
import { createMockDocx } from './fixtures'
import { CustomEntity } from '../core/types'
import JSZip from 'jszip'
import { parseXml } from '../core/xml'
import { OOXML_NAMESPACES } from '../core/constants'

describe('W-5d: Address boundaries, no dropped overlaps, NFD-safe offsets, independent residual, linear email scan', () => {
  // K1: Đoạn ở Vấn đề mục 1, KHÔNG entity
  it('K1: no entity masks address, phone, and email without dropping, leaves representative untouched', async () => {
    const paragraphText =
      'Địa chỉ: Số 1 Đường Test, Hà Nội; Điện thoại: 0912 345 678; Email: lienhe.test@example.com; Đại diện: Ông Người Đại Diện Test 01'

    const docxBytes = await createMockDocx({
      documentText: paragraphText,
    })

    const result = await anonymizeDocx(docxBytes, {}, {
      customEntities: [],
      maskKinds: {
        address: true,
        phone: true,
        email: true,
      },
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)
    const tNodes = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
    const fullText = tNodes.map((n) => n.textContent || '').join('')

    // Verify exact expected text
    expect(fullText).toBe(
      'Địa chỉ: ****, Hà Nội; Điện thoại: 09******78; Email: l****@e****.com; Đại diện: Ông Người Đại Diện Test 01'
    )

    // Verify replacements
    expect(result.report.replacements.entities).toBe(0)
    expect(result.report.replacements.byKind.address).toBe(1)
    expect(result.report.replacements.byKind.phone).toBe(1)
    expect(result.report.replacements.byKind.email).toBe(1)

    // Verify residual status: PASS (sensitive data masked, no entity registered)
    const residual = await scanResidual(await result.blob.arrayBuffer(), result.report.identities)
    expect(residual.status).toBe('PASS')
  })

  // K2: Cùng đoạn, CÓ entity Người Đại Diện Test 01
  it('K2: with entity replaces entity and masks address, phone, and email; replacements count all 4', async () => {
    const paragraphText =
      'Địa chỉ: Số 1 Đường Test, Hà Nội; Điện thoại: 0912 345 678; Email: lienhe.test@example.com; Đại diện: Ông Người Đại Diện Test 01'

    const docxBytes = await createMockDocx({
      documentText: paragraphText,
    })

    const entities: CustomEntity[] = [
      {
        id: 'ent-1',
        kind: 'representative',
        label: 'Người đại diện 1',
        values: ['Người Đại Diện Test 01'],
      },
    ]

    const result = await anonymizeDocx(docxBytes, {}, {
      customEntities: entities,
      maskKinds: {
        address: true,
        phone: true,
        email: true,
      },
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)
    const tNodes = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
    const fullText = tNodes.map((n) => n.textContent || '').join('')

    // Verify exact expected text
    expect(fullText).toBe(
      'Địa chỉ: ****, Hà Nội; Điện thoại: 09******78; Email: l****@e****.com; Đại diện: Ông Người đại diện 1'
    )

    // Verify replacements: exactly 1 entity, 1 address, 1 phone, 1 email
    expect(result.report.replacements.entities).toBe(1)
    expect(result.report.replacements.byKind.address).toBe(1)
    expect(result.report.replacements.byKind.phone).toBe(1)
    expect(result.report.replacements.byKind.email).toBe(1)

    // Residual PASS
    const residual = await scanResidual(
      await result.blob.arrayBuffer(),
      result.report.identities,
      entities
    )
    expect(residual.status).toBe('PASS')
  })

  // K3: Giả lập bỏ sót: chèn số điện thoại vào output trước khi scanResidual -> không PASS
  it('K3: unmasked phone inserted into output document is caught by independent residual scan -> NOT PASS', async () => {
    // Start with a clean document
    const docxBytes = await createMockDocx({
      documentText: 'Tài liệu sạch không có dữ liệu nhạy cảm.',
    })

    const result = await anonymizeDocx(docxBytes, {}, {
      maskKinds: { phone: true },
    })

    // Simulate a leak: insert an unmasked phone number into word/document.xml
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const docWithLeak = docXml.replace(
      'Tài liệu sạch không có dữ liệu nhạy cảm.',
      'Tài liệu có số điện thoại bị lộ: 0912 345 678.'
    )
    zip.file('word/document.xml', docWithLeak)

    const leakedBlobBytes = await zip.generateAsync({ type: 'arraybuffer' })

    const residual = await scanResidual(leakedBlobBytes, [], [], {
      maskKinds: { phone: true },
    })

    expect(residual.status).not.toBe('PASS')
    expect(residual.status).toBe('WARN')
    expect(residual.findings.some((f) => f.matchedString.includes('0912') || f.matchedString.includes('0912 345 678'))).toBe(true)
  })

  // K4: Trụ sở chính và điện thoại cố định
  it('K4: Trụ sở chính label and fixed-line phone are both correctly masked', async () => {
    const paragraphText =
      'Trụ sở chính: Tòa nhà Test, 123 Đường Mẫu, Quận Thử, TP. Hồ Chí Minh. Điện thoại: 028 3823 4567'

    const docxBytes = await createMockDocx({
      documentText: paragraphText,
    })

    const result = await anonymizeDocx(docxBytes, {}, {
      maskKinds: {
        address: true,
        phone: true,
      },
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)
    const tNodes = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
    const fullText = tNodes.map((n) => n.textContent || '').join('')

    expect(fullText).toBe(
      'Trụ sở chính: ****, ****, ****, TP. Hồ Chí Minh. Điện thoại: 02*******67'
    )
    expect(result.report.replacements.byKind.address).toBe(1)
    expect(result.report.replacements.byKind.phone).toBe(1)
  })

  // K5: An toàn với NFD
  it('K5: text in NFD form is correctly replaced without character corruption or offset shift', async () => {
    // Create text in NFD (decomposed characters)
    const originalNfd = 'Đại diện: Người Đại Diện Test 01 ký tên'.normalize('NFD')
    expect(originalNfd).not.toBe('Đại diện: Người Đại Diện Test 01 ký tên'.normalize('NFC'))

    const docxBytes = await createMockDocx({
      documentText: originalNfd,
    })

    const entities: CustomEntity[] = [
      {
        id: 'ent-1',
        kind: 'representative',
        label: 'Người đại diện 1',
        values: ['Người Đại Diện Test 01'],
      },
    ]

    const result = await anonymizeDocx(docxBytes, {}, {
      customEntities: entities,
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)
    const tNodes = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
    const fullText = tNodes.map((n) => n.textContent || '').join('')

    // Normalized to NFC, result must exactly match
    expect(fullText.normalize('NFC')).toBe('Đại diện: Người đại diện 1 ký tên')
    expect(result.report.replacements.entities).toBe(1)
  })

  // K6: findSensitive on bad strings runs < 50ms and normal emails detected correctly
  it('K6: findSensitive benchmark strings execute < 50ms and normal emails are accurately detected', () => {
    const testCases = [
      { name: "K6-1: 'a@' + 'a.'.repeat(30000)", text: 'a@' + 'a.'.repeat(30000) },
      { name: "K6-2: 'x'.repeat(50000) + '@'", text: 'x'.repeat(50000) + '@' },
      { name: "K6-3: 'a@b' + '.b'.repeat(20000) + '!'", text: 'a@b' + '.b'.repeat(20000) + '!' },
      { name: "K6-4: 'a@'.repeat(20000)", text: 'a@'.repeat(20000) },
    ]

    for (const tc of testCases) {
      const start = performance.now()
      findSensitive(tc.text)
      const duration = performance.now() - start
      console.log(`[${tc.name}] ${duration.toFixed(3)} ms`)
      expect(duration).toBeLessThan(50)
    }

    // Normal emails are detected properly
    const sampleText = 'Liên hệ email lienhe.test@example.com hoặc ten.test@sub.example.com.vn để được hỗ trợ.'
    const matches = findSensitive(sampleText).filter((m) => m.kind === 'email')
    expect(matches.length).toBe(2)
    expect(matches[0].value).toBe('lienhe.test@example.com')
    expect(matches[1].value).toBe('ten.test@sub.example.com.vn')
  })
})
