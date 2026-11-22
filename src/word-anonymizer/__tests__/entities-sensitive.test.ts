import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  anonymizeDocx,
  buildDefaultMapping,
  CustomEntity,
  findSensitive,
  inspectDocx,
  scanResidual,
  validateEntities,
} from '../core'
import { createMockDocx } from './fixtures'

describe('Part A: Entities & Sensitive Data Masking Core (W-5a)', () => {
  // A1: Run splitting
  it('A1: "Công ty TNHH Mẫu Thử" split into 3 runs -> Pháp nhân A, runs and formatting preserved', async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Kính gửi </w:t></w:r>
      <w:r><w:t>Công ty </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>TNHH Mẫu</w:t></w:r>
      <w:r><w:t> Thử</w:t></w:r>
      <w:r><w:t> trân trọng.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`

    const input = await createMockDocx({ documentXmlOverride: documentXml })
    const entities: CustomEntity[] = [
      {
        id: 'org1',
        kind: 'organization',
        label: 'Pháp nhân A',
        values: ['Công ty TNHH Mẫu Thử'],
      },
    ]

    const result = await anonymizeDocx(input, {}, { customEntities: entities })
    const outZip = await JSZip.loadAsync(result.blob)
    const outDocXml = await outZip.file('word/document.xml')!.async('string')

    expect(outDocXml).toContain('Pháp nhân A')
    expect(outDocXml).not.toContain('Công ty TNHH Mẫu Thử')
    expect(outDocXml).toContain('<w:b/>') // Bold formatting preserved
    expect(result.report.replacements.entities).toBe(1)
  })

  // A2: Case insensitive NFC, preserve accents
  it('A2: CÔNG TY TNHH MẪU THỬ is replaced; Cong ty TNHH Mau Thu (without diacritics) is NOT replaced', async () => {
    const input = await createMockDocx({
      documentText: 'CÔNG TY TNHH MẪU THỬ và Cong ty TNHH Mau Thu cùng tham gia.',
    })
    const entities: CustomEntity[] = [
      {
        id: 'org1',
        kind: 'organization',
        label: 'Pháp nhân A',
        values: ['Công ty TNHH Mẫu Thử'],
      },
    ]

    const result = await anonymizeDocx(input, {}, { customEntities: entities })
    const outZip = await JSZip.loadAsync(result.blob)
    const outDocXml = await outZip.file('word/document.xml')!.async('string')

    expect(outDocXml).toContain('Pháp nhân A và Cong ty TNHH Mau Thu cùng tham gia.')
    expect(outDocXml).not.toContain('CÔNG TY TNHH MẪU THỬ')
  })

  // A3: Whole word and longest match
  it('A3: "Mẫu Thử" does not replace inside "Mẫu Thửnghiệm"; longest match wins when overlapping', async () => {
    const input = await createMockDocx({
      documentText: 'Dự án Mẫu Thửnghiệm và Công ty TNHH Mẫu Thử.',
    })
    const entities: CustomEntity[] = [
      {
        id: 'org1',
        kind: 'organization',
        label: 'Pháp nhân A',
        values: ['Công ty TNHH Mẫu Thử', 'Mẫu Thử'],
      },
    ]

    const result = await anonymizeDocx(input, {}, { customEntities: entities })
    const outZip = await JSZip.loadAsync(result.blob)
    const outDocXml = await outZip.file('word/document.xml')!.async('string')

    expect(outDocXml).toContain('Dự án Mẫu Thửnghiệm và Pháp nhân A.')
    expect(result.report.replacements.entities).toBe(1)
  })

  // A4: Header, footnote, textbox, comments, and w:delText warning/residual
  it('A4: Replaces entity in header, footnote, textbox, comments; w:delText intact with WARN', async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Thân văn bản.</w:t></w:r>
      <w:r>
        <w:drawing>
          <w:txbxContent>
            <w:p><w:r><w:t>Hộp thoại: Người Đại Diện Test 01</w:t></w:r></w:p>
          </w:txbxContent>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p>
      <w:del w:author="NguoiSua">
        <w:r><w:delText>Đã xoá Người Đại Diện Test 01 tại đây</w:delText></w:r>
      </w:del>
    </w:p>
  </w:body>
</w:document>`

    const extraXmlFiles: Record<string, string> = {
      'word/header1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>Tiêu đề: Người Đại Diện Test 01</w:t></w:r></w:p>
</w:hdr>`,
      'word/footnotes.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="1"><w:p><w:r><w:t>Ghi chú: Người Đại Diện Test 01</w:t></w:r></w:p></w:footnote>
</w:footnotes>`,
    }

    const input = await createMockDocx({
      documentXmlOverride: documentXml,
      extraXmlFiles,
      comments: [
        {
          id: 1,
          author: 'Người góp ý 1',
          initials: 'NG1',
          text: 'Ý kiến từ Người Đại Diện Test 01',
        },
      ],
    })

    const entities: CustomEntity[] = [
      {
        id: 'rep1',
        kind: 'representative',
        label: 'Người đại diện 1',
        values: ['Người Đại Diện Test 01'],
      },
    ]

    const inspection = await inspectDocx(input, entities)
    expect(inspection.deletedTextHits.length).toBeGreaterThan(0)
    expect(inspection.warnings.some((w) => w.includes('Track Changes'))).toBe(true)

    // Variant 1: Default ('mask') mode replaces w:delText, residual PASS
    const result = await anonymizeDocx(input, {}, { customEntities: entities })
    const outZip = await JSZip.loadAsync(result.blob)

    const outDoc = await outZip.file('word/document.xml')!.async('string')
    const outHdr = await outZip.file('word/header1.xml')!.async('string')
    const outFoot = await outZip.file('word/footnotes.xml')!.async('string')
    const outComm = await outZip.file('word/comments.xml')!.async('string')

    expect(outDoc).toContain('Hộp thoại: Người đại diện 1')
    expect(outDoc).toContain('<w:delText>Đã xoá Người đại diện 1 tại đây</w:delText>') // w:delText is masked
    expect(outHdr).toContain('Tiêu đề: Người đại diện 1')
    expect(outFoot).toContain('Ghi chú: Người đại diện 1')
    expect(outComm).toContain('Ý kiến từ Người đại diện 1')

    const resReport = await scanResidual(
      await result.blob.arrayBuffer(),
      [],
      ['Người Đại Diện Test 01']
    )
    expect(resReport.status).toBe('PASS')

    // Variant 2: 'keep' mode keeps w:delText intact, findings list 'deleted-text', status remains PASS
    const resultKeep = await anonymizeDocx(input, {}, { customEntities: entities, deletedTextMode: 'keep' })
    const outZipKeep = await JSZip.loadAsync(resultKeep.blob)
    const outDocKeep = await outZipKeep.file('word/document.xml')!.async('string')
    expect(outDocKeep).toContain('<w:delText>Đã xoá Người Đại Diện Test 01 tại đây</w:delText>') // Untouched!

    const resReportKeep = await scanResidual(
      await resultKeep.blob.arrayBuffer(),
      [],
      ['Người Đại Diện Test 01'],
      { deletedTextMode: 'keep' }
    )
    expect(resReportKeep.findings.some((f) => f.category === 'deleted-text')).toBe(true)
    expect(resReportKeep.status).toBe('PASS')
  })

  // A5: Email in body, rels mailto:, field HYPERLINK
  it('A5: Email masked in body, rels mailto:, HYPERLINK; residual PASS; anonymized.invalid untouched', async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Liên hệ qua lienhe.test@example.com hoặc nguoi-gop-y-1@anonymized.invalid</w:t></w:r>
    </w:p>
    <w:p>
      <w:fldSimple w:instr="HYPERLINK &quot;mailto:lienhe.test@example.com&quot;">
        <w:r><w:t>Email chúng tôi</w:t></w:r>
      </w:fldSimple>
    </w:p>
  </w:body>
</w:document>`

    const extraXmlFiles: Record<string, string> = {
      'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDocMail" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:lienhe.test@example.com" TargetMode="External"/>
</Relationships>`,
    }

    const input = await createMockDocx({
      documentXmlOverride: documentXml,
      extraXmlFiles,
    })

    const result = await anonymizeDocx(input, {})
    const outZip = await JSZip.loadAsync(result.blob)
    const outDoc = await outZip.file('word/document.xml')!.async('string')
    const outRels = await outZip.file('word/_rels/document.xml.rels')!.async('string')

    expect(outDoc).toContain('l****@e****.com')
    expect(outDoc).toContain('nguoi-gop-y-1@anonymized.invalid')
    expect(outDoc).toContain('mailto:masked@anonymized.invalid')
    expect(outRels).toContain('Target="mailto:masked@anonymized.invalid"')

    const resReport = await scanResidual(
      await result.blob.arrayBuffer(),
      [],
      ['lienhe.test@example.com']
    )
    expect(resReport.status).toBe('PASS')
  })

  // A6: Phone numbers masked and not masked
  it('A6: Phone numbers masked to 0X******YY; money, dates, long numbers, letters not masked', async () => {
    const documentText =
      'Các số điện thoại: 0912345678, 0912 345 678, 091.234.5678, +84 912 345 678, (024) 3123 4567, 02431234567. ' +
      'Không che: 1.000.000.000, 19.11.2026, 12345678901234567890, A0912345678B.'

    const input = await createMockDocx({ documentText })
    const result = await anonymizeDocx(input, {})
    const outZip = await JSZip.loadAsync(result.blob)
    const outDoc = await outZip.file('word/document.xml')!.async('string')

    expect(outDoc).toContain('09******78')
    expect(outDoc).toContain('02*******67')
    expect(outDoc).toContain('1.000.000.000')
    expect(outDoc).toContain('19.11.2026')
    expect(outDoc).toContain('12345678901234567890')
    expect(outDoc).toContain('A0912345678B')
  })

  // A7: CCCD/CMND with and without keyword
  it('A7: CCCD masked when keyword within 40 chars; not masked without keyword', async () => {
    const documentText =
      'CCCD số: 001234567890 và Số định danh cá nhân 001234567891. Số khác 001234567892 không có từ khoá.'

    const input = await createMockDocx({ documentText })
    const result = await anonymizeDocx(input, {})
    const outZip = await JSZip.loadAsync(result.blob)
    const outDoc = await outZip.file('word/document.xml')!.async('string')

    expect(outDoc).toContain('CCCD số: *********890')
    expect(outDoc).toContain('Số định danh cá nhân *********891')
    expect(outDoc).toContain('001234567892')
  })

  // A8: MST with keyword; not recognized as phone without keyword
  it('A8: MST masked with keyword; 0101234567-001 without keyword not masked and not recognized as phone', async () => {
    const documentText =
      'MST: 0101234567-001 và Mã số thuế 0101234567. Mã độc lập: 0101234567-001.'

    const input = await createMockDocx({ documentText })
    const result = await anonymizeDocx(input, {})
    const outZip = await JSZip.loadAsync(result.blob)
    const outDoc = await outZip.file('word/document.xml')!.async('string')

    expect(outDoc).toContain('MST: *******567-001')
    expect(outDoc).toContain('Mã số thuế *******567')
    expect(outDoc).toContain('Mã độc lập: 0101234567-001')
  })

  // A9: STK priority over phone
  it('A9: STK masked; STK 0912345678 recognized as bankAccount, not phone', async () => {
    const documentText = 'Số tài khoản: 1234 5678 9012 và STK 0912345678.'

    const input = await createMockDocx({ documentText })
    const result = await anonymizeDocx(input, {})
    const outZip = await JSZip.loadAsync(result.blob)
    const outDoc = await outZip.file('word/document.xml')!.async('string')

    expect(outDoc).toContain('Số tài khoản: ********9012')
    expect(outDoc).toContain('STK ******5678')
    expect(result.report.replacements.byKind.bankAccount).toBe(2)
    expect(result.report.replacements.byKind.phone).toBe(0)
  })

  // A10: Address masking
  it('A10: Address masked after label to end of paragraph; non-address paragraph untouched', async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Địa chỉ: Số 1 Đường Test, Phường Mẫu, Quận Thử, Hà Nội</w:t></w:r></w:p>
    <w:p><w:r><w:t>Trụ sở: Tòa nhà Test</w:t></w:r></w:p>
    <w:p><w:r><w:t>Đoạn văn thông thường: Số 1 Đường Test, Phường Mẫu, Quận Thử, Hà Nội</w:t></w:r></w:p>
  </w:body>
</w:document>`

    const input = await createMockDocx({ documentXmlOverride: documentXml })
    const result = await anonymizeDocx(input, {})
    const outZip = await JSZip.loadAsync(result.blob)
    const outDoc = await outZip.file('word/document.xml')!.async('string')

    expect(outDoc).toContain('Địa chỉ: ****, ****, ****, Hà Nội')
    expect(outDoc).toContain('Trụ sở: ****')
    expect(outDoc).toContain('Đoạn văn thông thường: Số 1 Đường Test, Phường Mẫu, Quận Thử, Hà Nội')
  })

  // A11: keepValues and maskKinds toggle
  it('A11: keepValues preserves phone; maskKinds.address=false preserves address', async () => {
    const documentText =
      'Hotline: 0912 345 678, phụ trợ: 0987 654 321. Địa chỉ: Số 1 Đường Test, Hà Nội'

    const input = await createMockDocx({ documentText })
    const result = await anonymizeDocx(
      input,
      {},
      {
        keepValues: ['0912345678'],
        maskKinds: {
          email: true,
          phone: true,
          nationalId: true,
          taxCode: true,
          bankAccount: true,
          address: false,
        },
      }
    )

    const outZip = await JSZip.loadAsync(result.blob)
    const outDoc = await outZip.file('word/document.xml')!.async('string')

    expect(outDoc).toContain('0912 345 678') // Kept!
    expect(outDoc).toContain('09******21') // Masked
    expect(outDoc).toContain('Địa chỉ: Số 1 Đường Test, Hà Nội') // Kept because address=false
  })

  // A12: No entities and maskKinds all false -> identical to pre-W5
  it('A12: No entities and all maskKinds=false -> identical to pre-W5 behavior', async () => {
    const input = await createMockDocx({
      documentText: 'Giữ nguyên 0912345678 và lienhe@example.com',
      comments: [{ id: 1, author: 'Tác Giả Gốc', initials: 'TG', text: 'Bình luận' }],
    })

    const insp = await inspectDocx(input)
    const mapping = buildDefaultMapping(insp)

    const result = await anonymizeDocx(input, mapping, {
      customEntities: [],
      maskKinds: {
        email: false,
        phone: false,
        nationalId: false,
        taxCode: false,
        bankAccount: false,
        address: false,
      },
    })

    const outZip = await JSZip.loadAsync(result.blob)
    const outDoc = await outZip.file('word/document.xml')!.async('string')

    expect(outDoc).toContain('Giữ nguyên 0912345678 và lienhe@example.com')
    expect(result.report.replacements.entities).toBe(0)
    expect(result.report.replacements.byKind.email).toBe(0)
  })

  // A13: validateEntities
  it('A13: validateEntities returns Vietnamese errors for duplicate label, participant collision, short value, cross-entity value collision', () => {
    const mapping = {
      'Tác Giả 1': {
        label: 'Người góp ý 1',
        initials: 'NG1',
        alias: 'nguoi-gop-y-1',
      },
    }

    const invalidEntities: CustomEntity[] = [
      {
        id: '1',
        kind: 'organization',
        label: 'Người góp ý 1', // Collides with participant label
        values: ['A'], // 1 char
      },
      {
        id: '2',
        kind: 'organization',
        label: 'Pháp nhân B',
        values: ['Công ty Mẫu', 'C'], // 1 char
      },
      {
        id: '3',
        kind: 'representative',
        label: 'Pháp nhân B', // Duplicate label
        values: ['Công ty Mẫu'], // Collides with entity 2
      },
    ]

    const val = validateEntities(invalidEntities, mapping)
    expect(val.valid).toBe(false)
    expect(val.errors.some((e) => e.includes('trùng với nhãn người tham gia'))).toBe(true)
    expect(val.errors.some((e) => e.includes('ít nhất 2 ký tự'))).toBe(true)
    expect(val.errors.some((e) => e.includes('bị trùng lặp'))).toBe(true)
    expect(val.errors.some((e) => e.includes('xuất hiện ở cả hai thực thể'))).toBe(true)
  })

  // A14: Idempotence on second run
  it('A14: Running a 2nd time on processed file makes no further changes, report.replacements has counts only', async () => {
    const input = await createMockDocx({
      documentText: 'Công ty TNHH Mẫu Thử có hotline 0912345678 và email lienhe.test@example.com',
    })
    const entities: CustomEntity[] = [
      {
        id: 'org1',
        kind: 'organization',
        label: 'Pháp nhân A',
        values: ['Công ty TNHH Mẫu Thử'],
      },
    ]

    const result1 = await anonymizeDocx(input, {}, { customEntities: entities })
    expect(result1.report.replacements.entities).toBe(1)
    expect(result1.report.replacements.byKind.phone).toBe(1)
    expect(result1.report.replacements.byKind.email).toBe(1)

    const buf1 = await result1.blob.arrayBuffer()
    const result2 = await anonymizeDocx(buf1, {}, { customEntities: entities })
    expect(result2.report.replacements.entities).toBe(0)
    expect(result2.report.replacements.byKind.phone).toBe(0)
    expect(result2.report.replacements.byKind.email).toBe(0)

    // report.replacements only contains counts, no sensitive strings
    expect(typeof result2.report.replacements.entities).toBe('number')
    for (const count of Object.values(result2.report.replacements.byKind)) {
      expect(typeof count).toBe('number')
    }
  })

  // A15: Inspection returns sensitive findings and deleted text hits accurately
  it('A15: Inspection returns sensitive findings and deleted text hits accurately', async () => {
    const input = await createMockDocx({
      documentText: 'Hotline 0912345678 và email test@example.com.',
    })
    const report = await inspectDocx(input)
    expect(report.sensitive.length).toBe(2)
    expect(report.sensitive.some((s) => s.kind === 'phone')).toBe(true)
    expect(report.sensitive.some((s) => s.kind === 'email')).toBe(true)
  })

  // ReDoS Performance Benchmarks (< 50ms each)
  describe('ReDoS Performance Benchmarks', () => {
    it('S1: "0101234567-001 " repeated 2000 times runs < 50ms', () => {
      const text = '0101234567-001 '.repeat(2000)
      const t0 = performance.now()
      findSensitive(text)
      const elapsed = performance.now() - t0
      console.log(`[ReDoS S1] ${elapsed.toFixed(3)} ms`)
      expect(elapsed).toBeLessThan(50)
    })

    it('S2: "1".repeat(50000) + "x" runs < 50ms', () => {
      const text = '1'.repeat(50000) + 'x'
      const t0 = performance.now()
      findSensitive(text)
      const elapsed = performance.now() - t0
      console.log(`[ReDoS S2] ${elapsed.toFixed(3)} ms`)
      expect(elapsed).toBeLessThan(50)
    })

    it('S3: "1 2 3 4 5 6 7 8 9 ".repeat(5000) runs < 50ms', () => {
      const text = '1 2 3 4 5 6 7 8 9 '.repeat(5000)
      const t0 = performance.now()
      findSensitive(text)
      const elapsed = performance.now() - t0
      console.log(`[ReDoS S3] ${elapsed.toFixed(3)} ms`)
      expect(elapsed).toBeLessThan(50)
    })

    it('S4: "MST: " + "0".repeat(10000) runs < 50ms', () => {
      const text = 'MST: ' + '0'.repeat(10000)
      const t0 = performance.now()
      findSensitive(text)
      const elapsed = performance.now() - t0
      console.log(`[ReDoS S4] ${elapsed.toFixed(3)} ms`)
      expect(elapsed).toBeLessThan(50)
    })

    it('S5: "a@".repeat(20000) runs < 50ms', () => {
      const text = 'a@'.repeat(20000)
      const t0 = performance.now()
      findSensitive(text)
      const elapsed = performance.now() - t0
      console.log(`[ReDoS S5] ${elapsed.toFixed(3)} ms`)
      expect(elapsed).toBeLessThan(50)
    })
  })
})
