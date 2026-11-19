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

  // K6: Performance benchmark on repeated strings (< 200ms) and linear scaling (<= 2.5x on 2x length)
  it('K6: findSensitive executes < 200ms on 20000 repetitions and scales linearly', () => {
    const s1_20k = 'địa chỉ tại x, '.repeat(20000)
    const s1_40k = 'địa chỉ tại x, '.repeat(40000)

    const start1_20 = performance.now()
    findSensitive(s1_20k)
    const time1_20 = performance.now() - start1_20

    const start1_40 = performance.now()
    findSensitive(s1_40k)
    const time1_40 = performance.now() - start1_40

    expect(time1_20).toBeLessThan(200)
    expect(time1_40 / time1_20).toBeLessThanOrEqual(2.5)

    const s2_20k = 'trụ sở tại '.repeat(20000)
    const s2_40k = 'trụ sở tại '.repeat(40000)

    const start2_20 = performance.now()
    findSensitive(s2_20k)
    const time2_20 = performance.now() - start2_20

    const start2_40 = performance.now()
    findSensitive(s2_40k)
    const time2_40 = performance.now() - start2_40

    expect(time2_20).toBeLessThan(200)
    expect(time2_40 / time2_20).toBeLessThanOrEqual(2.5)
  })
})
