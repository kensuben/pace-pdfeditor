import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { anonymizeDocx } from '../core/anonymize'
import { scanResidual } from '../core/residual'
import { findAddresses, findSensitive } from '../core/sensitive'
import { AnonymizeOptions, CustomEntity } from '../core/types'
import { createMockDocx } from './fixtures'

describe('F-10: Residual Options, Inline Address Detection, and Vietnamese Diacritics', () => {
  // K1: Core logic verification for keepValues and maskKinds in scanResidual
  it('K1: keepValues preserves phone; maskKinds.phone=false preserves phone; residual PASS in both', async () => {
    const fixtureText = 'Điện thoại: 0912 345 678; Email: lienhe.test@example.com'
    const docxBytes = await createMockDocx({ documentText: fixtureText })

    // Case a: keepValues = ['0912345678']
    const optsKeep: Partial<AnonymizeOptions> = {
      maskKinds: { phone: true, email: true },
      keepValues: ['0912345678'],
    }
    const resultKeep = await anonymizeDocx(docxBytes, {}, optsKeep)
    const outKeepBytes = await resultKeep.blob.arrayBuffer()
    const residualKeep = await scanResidual(outKeepBytes, [], [], {
      maskKinds: optsKeep.maskKinds,
      keepValues: optsKeep.keepValues,
    })

    expect(residualKeep.status).toBe('PASS')
    expect(residualKeep.findings).toEqual([])

    const zipKeep = await JSZip.loadAsync(outKeepBytes)
    const docKeepXml = await zipKeep.file('word/document.xml')!.async('string')
    expect(docKeepXml).toContain('0912 345 678')
    expect(docKeepXml).toContain('l****@e****.com')

    // Case b: maskKinds.phone = false
    const optsDisable: Partial<AnonymizeOptions> = {
      maskKinds: { phone: false, email: true },
      keepValues: [],
    }
    const resultDisable = await anonymizeDocx(docxBytes, {}, optsDisable)
    const outDisableBytes = await resultDisable.blob.arrayBuffer()
    const residualDisable = await scanResidual(outDisableBytes, [], [], {
      maskKinds: optsDisable.maskKinds,
      keepValues: optsDisable.keepValues,
    })

    expect(residualDisable.status).toBe('PASS')
    expect(residualDisable.findings).toEqual([])

    const zipDisable = await JSZip.loadAsync(outDisableBytes)
    const docDisableXml = await zipDisable.file('word/document.xml')!.async('string')
    expect(docDisableXml).toContain('0912 345 678')
    expect(docDisableXml).toContain('l****@e****.com')
  })

  // K2: Inline address with MST, entities, and comma stop
  it('K2: inline address with 2 entities and MST stops correctly; residual PASS', async () => {
    const text =
      'Bên A: Công ty TNHH Mẫu Thử, địa chỉ tại Số 1 Đường Test, Hà Nội, MST 0101234567, do Ông Người Đại Diện Test 01 làm đại diện'
    const docxBytes = await createMockDocx({ documentText: text })

    const customEntities: CustomEntity[] = [
      { id: '1', kind: 'organization', label: 'Pháp nhân A', values: ['Công ty TNHH Mẫu Thử'] },
      { id: '2', kind: 'representative', label: 'Người đại diện 1', values: ['Người Đại Diện Test 01'] },
    ]

    const opts: Partial<AnonymizeOptions> = {
      customEntities,
      maskKinds: { address: true, taxCode: true },
    }

    const result = await anonymizeDocx(docxBytes, {}, opts)
    const outBytes = await result.blob.arrayBuffer()

    const residual = await scanResidual(outBytes, [], customEntities, {
      maskKinds: opts.maskKinds,
    })

    expect(residual.status).toBe('PASS')

    const zip = await JSZip.loadAsync(outBytes)
    const outDoc = await zip.file('word/document.xml')!.async('string')
    expect(outDoc).toContain(
      'Bên A: Pháp nhân A, địa chỉ tại ****, Hà Nội, MST *******567, do Ông Người đại diện 1 làm đại diện'
    )
  })

  // K3: Inline address stops before dot + uppercase letter (abbreviations like TP. preserved)
  it('K3: inline address stops before dot followed by uppercase; residual PASS', async () => {
    const text =
      'Công ty có trụ sở tại Tòa nhà Test, 123 Đường Mẫu, TP. Hồ Chí Minh. Ngành nghề: đào tạo'
    const docxBytes = await createMockDocx({ documentText: text })

    const opts: Partial<AnonymizeOptions> = {
      maskKinds: { address: true },
    }

    const result = await anonymizeDocx(docxBytes, {}, opts)
    const outBytes = await result.blob.arrayBuffer()

    const residual = await scanResidual(outBytes, [], [], {
      maskKinds: opts.maskKinds,
    })

    expect(residual.status).toBe('PASS')

    const zip = await JSZip.loadAsync(outBytes)
    const outDoc = await zip.file('word/document.xml')!.async('string')
    expect(outDoc).toContain('Công ty có trụ sở tại ****, ****, TP. Hồ Chí Minh. Ngành nghề: đào tạo')
  })

  // K4: Address with semicolon and phone
  it('K4: inline address stops at semicolon; phone masked; residual PASS', async () => {
    const text = 'Ông A thường trú tại Số 2 Đường Mẫu, Phường Thử, Đà Nẵng; điện thoại 0987654321'
    const docxBytes = await createMockDocx({ documentText: text })

    const opts: Partial<AnonymizeOptions> = {
      maskKinds: { address: true, phone: true },
    }

    const result = await anonymizeDocx(docxBytes, {}, opts)
    const outBytes = await result.blob.arrayBuffer()

    const residual = await scanResidual(outBytes, [], [], {
      maskKinds: opts.maskKinds,
    })

    expect(residual.status).toBe('PASS')

    const zip = await JSZip.loadAsync(outBytes)
    const outDoc = await zip.file('word/document.xml')!.async('string')
    expect(outDoc).toContain('Ông A thường trú tại ****, ****, Đà Nẵng; điện thoại 09******21')
  })

  // K5: Do not falsely mask sentences mentioning "địa chỉ" without address labels
  it('K5: does not falsely recognize "địa chỉ" without labels as address', () => {
    const sentences = [
      'Vui lòng cập nhật địa chỉ email của bạn',
      'Kiểm tra địa chỉ IP của máy',
      'Chúng tôi sẽ gửi tới địa chỉ đã đăng ký',
    ]

    for (const s of sentences) {
      const addrMatches = findAddresses(s)
      expect(addrMatches).toEqual([])

      const sensMatches = findSensitive(s)
      const detectedAddresses = sensMatches.filter((m) => m.kind === 'address')
      expect(detectedAddresses).toEqual([])
    }
  })

  // Verification of all 10 inline and colon opening labels
  it('recognizes all specified address labels with and without accents', () => {
    const labels = [
      'địa chỉ tại',
      'dia chi tai',
      'có địa chỉ tại',
      'co dia chi tai',
      'trụ sở tại',
      'tru so tai',
      'có trụ sở tại',
      'co tru so tai',
      'trụ sở chính tại',
      'tru so chinh tai',
      'địa chỉ trụ sở tại',
      'dia chi tru so tai',
      'thường trú tại',
      'thuong tru tai',
      'cư trú tại',
      'cu tru tai',
      'địa chỉ là',
      'dia chi la',
      'địa chỉ:',
      'dia chi:',
    ]

    for (const label of labels) {
      const text = `Thông tin bên A: ${label} Số 1 Đường Test, Hà Nội; ghi chú`
      const matches = findAddresses(text)
      expect(matches.length).toBeGreaterThanOrEqual(1)
      expect(matches[0].value).toBe('Số 1 Đường Test, Hà Nội')
    }
  })

  // K6: Performance benchmark on repeated strings (< 200ms) and linear scaling (<= 3x on 2x length)
  it('K6: findSensitive executes < 200ms on 20000 repetitions and scales linearly', () => {
    const measureMedian = (text: string): number => {
      findSensitive(text) // warm-up
      const times: number[] = []
      for (let i = 0; i < 5; i++) {
        const start = performance.now()
        findSensitive(text)
        times.push(performance.now() - start)
      }
      times.sort((a, b) => a - b)
      return times[Math.floor(times.length / 2)]
    }

    const s1_20k = 'địa chỉ tại x, '.repeat(20000)
    const s1_40k = 'địa chỉ tại x, '.repeat(40000)

    const time1_20 = measureMedian(s1_20k)
    const time1_40 = measureMedian(s1_40k)

    expect(time1_20).toBeLessThan(200)
    expect(time1_40 / time1_20).toBeLessThanOrEqual(3)

    const s2_20k = 'trụ sở tại '.repeat(20000)
    const s2_40k = 'trụ sở tại '.repeat(40000)

    const time2_20 = measureMedian(s2_20k)
    const time2_40 = measureMedian(s2_40k)

    expect(time2_20).toBeLessThan(200)
    expect(time2_40 / time2_20).toBeLessThanOrEqual(3)
  })

  // F-10b: Tests T1 - T4
  describe('F-10b: Dot stop only at real uppercase and narrowed dia chi la', () => {
    // T1: 2 câu ở mục 1 -> toàn bộ địa chỉ trước dấu phẩy cuối bị che; không còn "tầng 5", "phường Mẫu", "quận Thử"
    it('T1: dot followed by lowercase letter does not stop address; no leak of lower-case segments', async () => {
      // Sentence 1
      const text1 = 'Địa chỉ: Số 3 Đường Test. tầng 5, Hà Nội'
      const docx1 = await createMockDocx({ documentText: text1 })
      const res1 = await anonymizeDocx(docx1, {}, { maskKinds: { address: true } })
      const outBytes1 = await res1.blob.arrayBuffer()
      const residual1 = await scanResidual(outBytes1, [], [], { maskKinds: { address: true } })
      expect(residual1.status).toBe('PASS')

      const zip1 = await JSZip.loadAsync(outBytes1)
      const docXml1 = await zip1.file('word/document.xml')!.async('string')
      expect(docXml1).toContain('Địa chỉ: ****, Hà Nội')
      expect(docXml1).not.toContain('tầng 5')

      // Sentence 2
      const text2 = 'Có trụ sở tại số 10 ngõ 5 phố Test. phường Mẫu, quận Thử, Hà Nội.'
      const docx2 = await createMockDocx({ documentText: text2 })
      const res2 = await anonymizeDocx(docx2, {}, { maskKinds: { address: true } })
      const outBytes2 = await res2.blob.arrayBuffer()
      const residual2 = await scanResidual(outBytes2, [], [], { maskKinds: { address: true } })
      expect(residual2.status).toBe('PASS')

      const zip2 = await JSZip.loadAsync(outBytes2)
      const docXml2 = await zip2.file('word/document.xml')!.async('string')
      expect(docXml2).toContain('Có trụ sở tại ****, ****, Hà Nội.')
      expect(docXml2).not.toContain('phường Mẫu')
      expect(docXml2).not.toContain('quận Thử')
    })

    // T2: K3 cũ vẫn đúng (dừng trước ". Ngành")
    it('T2: stops before dot followed by real uppercase (K3 preserved)', async () => {
      const text = 'Công ty có trụ sở tại Tòa nhà Test, 123 Đường Mẫu, TP. Hồ Chí Minh. Ngành nghề: đào tạo'
      const docxBytes = await createMockDocx({ documentText: text })
      const res = await anonymizeDocx(docxBytes, {}, { maskKinds: { address: true } })
      const outBytes = await res.blob.arrayBuffer()
      const residual = await scanResidual(outBytes, [], [], { maskKinds: { address: true } })
      expect(residual.status).toBe('PASS')

      const zip = await JSZip.loadAsync(outBytes)
      const outDoc = await zip.file('word/document.xml')!.async('string')
      expect(outDoc).toContain('Công ty có trụ sở tại ****, ****, TP. Hồ Chí Minh. Ngành nghề: đào tạo')
    })

    // T3: "Địa chỉ là nơi quan trọng trong hồ sơ" -> không có vùng địa chỉ
    it('T3: "Địa chỉ là" not followed by number/location identifier is not recognized as address', async () => {
      const text = 'Địa chỉ là nơi quan trọng trong hồ sơ'
      const addrMatches = findAddresses(text)
      expect(addrMatches).toEqual([])

      const sensMatches = findSensitive(text)
      const addrSens = sensMatches.filter((m) => m.kind === 'address')
      expect(addrSens).toEqual([])

      const docxBytes = await createMockDocx({ documentText: text })
      const res = await anonymizeDocx(docxBytes, {}, { maskKinds: { address: true } })
      const outBytes = await res.blob.arrayBuffer()
      const zip = await JSZip.loadAsync(outBytes)
      const outDoc = await zip.file('word/document.xml')!.async('string')
      expect(outDoc).toContain('Địa chỉ là nơi quan trọng trong hồ sơ')
    })

    // T4: "Địa chỉ là Số 1 Đường Test, Hà Nội" -> "Địa chỉ là ****, Hà Nội"
    it('T4: "Địa chỉ là" followed by "Số" is recognized and masked properly', async () => {
      const text = 'Địa chỉ là Số 1 Đường Test, Hà Nội'
      const addrMatches = findAddresses(text)
      expect(addrMatches.length).toBe(1)
      expect(addrMatches[0].value).toBe('Số 1 Đường Test, Hà Nội')

      const docxBytes = await createMockDocx({ documentText: text })
      const res = await anonymizeDocx(docxBytes, {}, { maskKinds: { address: true } })
      const outBytes = await res.blob.arrayBuffer()
      const residual = await scanResidual(outBytes, [], [], { maskKinds: { address: true } })
      expect(residual.status).toBe('PASS')

      const zip = await JSZip.loadAsync(outBytes)
      const outDoc = await zip.file('word/document.xml')!.async('string')
      expect(outDoc).toContain('Địa chỉ là ****, Hà Nội')
    })
  })

  // F-10c: Tests T5 - T7 (Unicode-aware abbreviation boundaries)
  describe('F-10c: Unicode-aware abbreviation boundary in dot stop', () => {
    // T5: câu ở mục 1 -> địa chỉ = "Số 5 phố Lý Thường Kiệt"; "Ngành nghề: đào tạo, tư vấn và xuất bản" giữ nguyên
    it('T5: stops at dot after non-ASCII Vietnamese word ending with abbreviation letter (Kiệt.)', async () => {
      const text = 'Công ty có trụ sở tại Số 5 phố Lý Thường Kiệt. Ngành nghề: đào tạo, tư vấn và xuất bản'
      const matches = findAddresses(text)
      expect(matches.length).toBe(1)
      expect(matches[0].value).toBe('Số 5 phố Lý Thường Kiệt')

      const docxBytes = await createMockDocx({ documentText: text })
      const res = await anonymizeDocx(docxBytes, {}, { maskKinds: { address: true } })
      const outBytes = await res.blob.arrayBuffer()
      const residual = await scanResidual(outBytes, [], [], { maskKinds: { address: true } })
      expect(residual.status).toBe('PASS')

      const zip = await JSZip.loadAsync(outBytes)
      const outDoc = await zip.file('word/document.xml')!.async('string')
      expect(outDoc).toContain('Công ty có trụ sở tại ****. Ngành nghề: đào tạo, tư vấn và xuất bản')
    })

    // T6: tương tự với "Đường Test Việt." và "Khu Tân Phát." -> dừng đúng tại dấu chấm
    it('T6: stops at dot for words ending with other abbreviation letters like Việt. and Phát.', async () => {
      const text1 = 'Địa chỉ: Số 1 Đường Test Việt. Ngành nghề: đào tạo'
      const m1 = findAddresses(text1)
      expect(m1.length).toBe(1)
      expect(m1[0].value).toBe('Số 1 Đường Test Việt')

      const text2 = 'Có trụ sở tại Tòa nhà A, Khu Tân Phát. Doanh thu: 100 tỷ'
      const m2 = findAddresses(text2)
      expect(m2.length).toBe(1)
      expect(m2[0].value).toBe('Tòa nhà A, Khu Tân Phát')

      const docx1 = await createMockDocx({ documentText: text1 })
      const res1 = await anonymizeDocx(docx1, {}, { maskKinds: { address: true } })
      const outBytes1 = await res1.blob.arrayBuffer()
      const zip1 = await JSZip.loadAsync(outBytes1)
      const docXml1 = await zip1.file('word/document.xml')!.async('string')
      expect(docXml1).toContain('Địa chỉ: ****. Ngành nghề: đào tạo')

      const docx2 = await createMockDocx({ documentText: text2 })
      const res2 = await anonymizeDocx(docx2, {}, { maskKinds: { address: true } })
      const outBytes2 = await res2.blob.arrayBuffer()
      const zip2 = await JSZip.loadAsync(outBytes2)
      const docXml2 = await zip2.file('word/document.xml')!.async('string')
      expect(docXml2).toContain('Có trụ sở tại ****, Khu Tân Phát. Doanh thu: 100 tỷ')
    })

    // T7: "TP. Hồ Chí Minh", "Tp. Thủ Đức", "Q. 1", "P. 5" vẫn KHÔNG bị cắt
    it('T7: legitimate abbreviations TP., Tp., Q., P. are not cut prematurely', () => {
      const s1 = 'Địa chỉ: Tòa nhà Test, 123 Đường Mẫu, TP. Hồ Chí Minh. Ghi chú: không'
      const m1 = findAddresses(s1)
      expect(m1.length).toBe(1)
      expect(m1[0].value).toBe('Tòa nhà Test, 123 Đường Mẫu, TP. Hồ Chí Minh')

      const s2 = 'Địa chỉ: Số 1 Đường Test, Tp. Thủ Đức. Ghi chú: không'
      const m2 = findAddresses(s2)
      expect(m2.length).toBe(1)
      expect(m2[0].value).toBe('Số 1 Đường Test, Tp. Thủ Đức')

      const s3 = 'Địa chỉ: Số 1 Đường Test, Q. 1, TP. Hồ Chí Minh'
      const m3 = findAddresses(s3)
      expect(m3.length).toBe(1)
      expect(m3[0].value).toBe('Số 1 Đường Test, Q. 1, TP. Hồ Chí Minh')

      const s4 = 'Địa chỉ: Số 1 Đường Test, P. 5, Quận 3'
      const m4 = findAddresses(s4)
      expect(m4.length).toBe(1)
      expect(m4[0].value).toBe('Số 1 Đường Test, P. 5, Quận 3')
    })
  })
})
