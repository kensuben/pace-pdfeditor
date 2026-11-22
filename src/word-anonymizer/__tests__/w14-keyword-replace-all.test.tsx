import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import {
  anonymizeDocx,
  scanResidual,
  parseXml,
  findKeywordMatches,
  validateKeywordRules,
  countKeywordMatches,
  CustomEntity,
  IdentityMapping,
  KeywordRule,
  OOXML_NAMESPACES,
} from '../core'
import WordAnonymizerPage from '../WordAnonymizerPage'
import { createMockDocx, createW14FixtureDocx } from './fixtures'
import type { AccountInfo } from '@azure/msal-browser'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

const mockAccount: AccountInfo = {
  homeAccountId: 'test-account-id',
  environment: 'login.windows.net',
  tenantId: 'test-tenant-id',
  username: 'hocvien.test01@example.com',
  localAccountId: 'test-local-id',
  name: 'Học viên Test 01',
}

const mapping: IdentityMapping = {
  'author 1': {
    label: 'Người dùng 1',
    initials: 'ND1',
    alias: 'User1',
  },
  'Author 1': {
    label: 'Người dùng 1',
    initials: 'ND1',
    alias: 'User1',
  },
}

describe('W-14: User keyword replace-all rules', () => {
  // K1: findKeywordMatches
  it('K1: matches exact whole words, case-insensitively, handles multiple spaces, rejects partial words', () => {
    const rules: KeywordRule[] = [
      {
        id: 'kw-1',
        find: 'Giám đốc',
        replace: 'Người điều hành',
      },
    ]

    // Matches lowercase and uppercase
    const text1 = 'Quyết định của giám đốc và GIÁM ĐỐC công ty.'
    const matches1 = findKeywordMatches(text1, rules)
    expect(matches1.length).toBe(2)
    expect(matches1[0].replacementText).toBe('Người điều hành')
    expect(text1.slice(matches1[0].start, matches1[0].end)).toBe('giám đốc')
    expect(text1.slice(matches1[1].start, matches1[1].end)).toBe('GIÁM ĐỐC')

    // Does NOT match inside longer word "Phó Giám đốcX"
    const text2 = 'Ông là Phó Giám đốcX của dự án.'
    const matches2 = findKeywordMatches(text2, rules)
    expect(matches2.length).toBe(0)

    // Matches with multiple spaces
    const text3 = 'Chức vụ: Giám  đốc điều hành.'
    const matches3 = findKeywordMatches(text3, rules)
    expect(matches3.length).toBe(1)
    expect(text3.slice(matches3[0].start, matches3[0].end)).toBe('Giám  đốc')
  })

  // K2: ignoreDiacritics
  it('K2: ignoreDiacritics matches unaccented keyword to accented text with exact offsets, non-diacritics does not match', () => {
    const rulesWithDiacritics: KeywordRule[] = [
      {
        id: 'kw-diacritics',
        find: 'Giam doc',
        replace: 'Lãnh đạo',
        ignoreDiacritics: true,
      },
    ]

    const text = 'Ban Giám đốc đã họp.'
    const matches = findKeywordMatches(text, rulesWithDiacritics)
    expect(matches.length).toBe(1)
    // Offset points exactly to original string
    expect(matches[0].start).toBe(4)
    expect(matches[0].end).toBe(12)
    expect(text.slice(matches[0].start, matches[0].end)).toBe('Giám đốc')

    // Without ignoreDiacritics, it must NOT match
    const rulesExact: KeywordRule[] = [
      {
        id: 'kw-exact',
        find: 'Giam doc',
        replace: 'Lãnh đạo',
        ignoreDiacritics: false,
      },
    ]
    const matchesExact = findKeywordMatches(text, rulesExact)
    expect(matchesExact.length).toBe(0)
  })

  // K3: Priority: entity -> keyword -> sensitive
  it('K3: entity takes priority over keyword, keyword takes priority over sensitive phone', async () => {
    const customEntities: CustomEntity[] = [
      {
        id: 'ent-1',
        kind: 'organization',
        label: 'Pháp nhân A',
        values: ['Công ty TNHH Mẫu Thử'],
      },
    ]

    const keywordRules: KeywordRule[] = [
      {
        id: 'kw-mt',
        find: 'Mẫu Thử',
        replace: 'MT',
      },
      {
        id: 'kw-phone',
        find: '0912 345 678',
        replace: 'SĐT BẢO MẬT',
      },
    ]

    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${OOXML_NAMESPACES.w}">
  <w:body>
    <w:p>
      <w:r><w:t>Bên A là Công ty TNHH Mẫu Thử, liên hệ 0912 345 678 để xác nhận.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`

    const fixtureBuffer = await createMockDocx({ documentXmlOverride: docXml })
    const result = await anonymizeDocx(fixtureBuffer, mapping, {
      customEntities,
      keywordRules,
      maskKinds: { phone: true },
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const outputXml = await zip.file('word/document.xml')!.async('string')

    // Entity priority: replaced with "Pháp nhân A", no leftover "Mẫu Thử" fragment
    expect(outputXml).toContain('Pháp nhân A')
    expect(outputXml).not.toContain('Công ty TNHH Mẫu Thử')
    expect(outputXml).not.toContain('MT')

    // Keyword priority over sensitive: phone replaced by keyword "SĐT BẢO MẬT", not sensitive "09******78"
    expect(outputXml).toContain('SĐT BẢO MẬT')
    expect(outputXml).not.toContain('09******78')
    expect(outputXml).not.toContain('0912 345 678')

    expect(result.report.replacements.entities).toBe(1)
    expect(result.report.replacements.keywords).toBe(1)
  })

  // K4: Multi-run keyword & all parts (body, comment, header, delText with mask & keep)
  it('K4: multi-run keyword in body, comment, header and delText (mask) are all replaced; keep preserves delText', async () => {
    const fixtureBuffer = await createW14FixtureDocx()
    const keywordRules: KeywordRule[] = [
      {
        id: 'kw-uq',
        find: 'Giấy Ủy Quyền số 01/2026/UQ-TEST',
        replace: 'GUQ-ANONYMIZED',
      },
    ]

    // 1. mask mode (default): replaced across all 4 locations
    const resMask = await anonymizeDocx(fixtureBuffer, mapping, {
      keywordRules,
      deletedTextMode: 'mask',
    })

    const zipMask = await JSZip.loadAsync(await resMask.blob.arrayBuffer())
    const bodyXmlMask = await zipMask.file('word/document.xml')!.async('string')
    const headerXmlMask = await zipMask.file('word/header1.xml')!.async('string')
    const commentsXmlMask = await zipMask.file('word/comments.xml')!.async('string')

    expect(bodyXmlMask).toContain('GUQ-ANONYMIZED')
    expect(bodyXmlMask).not.toContain('01/2026/UQ-TEST')

    expect(headerXmlMask).toContain('GUQ-ANONYMIZED')
    expect(headerXmlMask).not.toContain('01/2026/UQ-TEST')

    expect(commentsXmlMask).toContain('GUQ-ANONYMIZED')
    expect(commentsXmlMask).not.toContain('01/2026/UQ-TEST')

    // delText in mask mode replaced
    const docMask = parseXml(bodyXmlMask)
    const delTextsMask = Array.from(docMask.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
    const delCombinedMask = delTextsMask.map((n) => n.textContent || '').join('')
    expect(delCombinedMask).toContain('GUQ-ANONYMIZED')

    // 2. keep mode: delText is preserved
    const resKeep = await anonymizeDocx(fixtureBuffer, mapping, {
      keywordRules,
      deletedTextMode: 'keep',
    })
    const zipKeep = await JSZip.loadAsync(await resKeep.blob.arrayBuffer())
    const bodyXmlKeep = await zipKeep.file('word/document.xml')!.async('string')
    const docKeep = parseXml(bodyXmlKeep)
    const delTextsKeep = Array.from(docKeep.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
    const delCombinedKeep = delTextsKeep.map((n) => n.textContent || '').join('')
    expect(delCombinedKeep).toContain('Giấy Ủy Quyền số 01/2026/UQ-TEST')
  })

  // K5: Empty replace -> ****
  it('K5: empty or whitespace replace defaults to ****', () => {
    const rules: KeywordRule[] = [
      {
        id: 'kw-empty',
        find: 'Dự án Mẫu Thử',
        replace: '',
      },
    ]

    const text = 'Hợp tác phát triển Dự án Mẫu Thử năm 2026.'
    const matches = findKeywordMatches(text, rules)
    expect(matches.length).toBe(1)
    expect(matches[0].replacementText).toBe('****')
  })

  // K6: Validation rules
  it('K6: validateKeywordRules catches find < 2 chars, duplicate find, replace contains find, and find matches entity/identity label', () => {
    const entities: CustomEntity[] = [
      {
        id: 'ent-1',
        kind: 'organization',
        label: 'Pháp nhân A',
        values: ['Công ty ABC'],
      },
    ]

    const mappingValidation: IdentityMapping = {
      'User 1': {
        label: 'Giảng viên A',
        initials: 'GVA',
        alias: 'gv-a',
      },
    }

    const testRules: KeywordRule[] = [
      // 1. find < 2 chars
      { id: 'r1', find: 'X ', replace: 'TEST' },
      // 2. duplicate find
      { id: 'r2', find: 'Mã hợp đồng', replace: 'HD1' },
      { id: 'r3', find: 'MÃ HỢP ĐỒNG', replace: 'HD2' },
      // 3. replace contains find
      { id: 'r4', find: 'Dự án X', replace: 'Thực hiện Dự án X mới' },
      // 4. find matches entity label
      { id: 'r5', find: 'Pháp nhân A', replace: 'PA' },
      // 5. find matches identity label
      { id: 'r6', find: 'Giảng viên A', replace: 'GVA' },
      // 6. valid rule
      { id: 'r7', find: 'Giám đốc', replace: 'Lãnh đạo' },
    ]

    const result = validateKeywordRules(testRules, entities, mappingValidation)
    expect(result.valid).toBe(false)
    expect(result.errors.r1).toBe('Từ khoá phải có ít nhất 2 ký tự')
    expect(result.errors.r2).toBe('Từ khoá bị trùng lặp')
    expect(result.errors.r3).toBe('Từ khoá bị trùng lặp')
    expect(result.errors.r4).toBe('Giá trị thay thế không được chứa từ khoá')
    expect(result.errors.r5).toBe('Từ khoá trùng với nhãn pháp nhân hoặc người tham gia đang dùng')
    expect(result.errors.r6).toBe('Từ khoá trùng với nhãn pháp nhân hoặc người tham gia đang dùng')
    expect(result.errors.r7).toBeUndefined()
  })

  // K7: scanResidual: flags leftover keywords with WARN, does NOT flag keywords inside another rule's replacement
  it('K7: scanResidual flags leftover keywords as WARN, does not flag keyword inside replacement of another rule', async () => {
    // 1. Residual leak: document has "Dự án Mẫu Thử", rule was not replaced
    const docXmlWithLeak = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${OOXML_NAMESPACES.w}">
  <w:body>
    <w:p><w:r><w:t>Còn sót Dự án Mẫu Thử trong file.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const leakBuffer = await createMockDocx({ documentXmlOverride: docXmlWithLeak })
    const leakReport = await scanResidual(leakBuffer, [], [], {
      keywordRules: [{ id: 'kw-leak', find: 'Dự án Mẫu Thử', replace: 'DA-A' }],
    })
    expect(leakReport.status).toBe('WARN')
    expect(leakReport.findings.some((f) => f.matchedString === 'Dự án Mẫu Thử')).toBe(true)

    // 2. Chained/nested replacement: rule A "Alpha" -> "Dự án Beta", rule B "Beta" -> "Gamma"
    // Original doc only has "Alpha". Result has "Dự án Beta".
    // scanResidual should NOT flag "Beta" because it's inside Rule A's replace!
    const docXmlChain = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${OOXML_NAMESPACES.w}">
  <w:body>
    <w:p><w:r><w:t>Hợp đồng về Alpha chính thức.</w:t></w:r></w:p>
  </w:body>
</w:document>`
    const chainBuffer = await createMockDocx({ documentXmlOverride: docXmlChain })
    const chainRules: KeywordRule[] = [
      { id: 'rule-a', find: 'Alpha', replace: 'Dự án Beta' },
      { id: 'rule-b', find: 'Beta', replace: 'Gamma' },
    ]
    const anonymizedChain = await anonymizeDocx(chainBuffer, mapping, {
      keywordRules: chainRules,
    })
    const outBytes = await anonymizedChain.blob.arrayBuffer()
    const zipChain = await JSZip.loadAsync(outBytes)
    const outXml = await zipChain.file('word/document.xml')!.async('string')
    expect(outXml).toContain('Dự án Beta')

    const chainResidual = await scanResidual(outBytes, [], [], {
      keywordRules: chainRules,
    })
    expect(chainResidual.status).toBe('PASS')
    expect(chainResidual.findings.length).toBe(0)
  })

  // K8: countKeywordMatches
  it('K8: countKeywordMatches returns exact counts by rule and by group (body, deleted, comments, headerFooter)', async () => {
    const fixtureBuffer = await createW14FixtureDocx()
    const rules: KeywordRule[] = [
      {
        id: 'kw-1',
        find: 'Giấy Ủy Quyền số 01/2026/UQ-TEST',
        replace: 'GUQ',
      },
    ]

    const counts = await countKeywordMatches(fixtureBuffer, rules, 'mask')
    expect(counts.total).toBe(4)
    expect(counts.byRule['kw-1']).toBe(4)
    expect(counts.byGroup.body).toBe(1)
    expect(counts.byGroup.deleted).toBe(1)
    expect(counts.byGroup.comments).toBe(1)
    expect(counts.byGroup.headerFooter).toBe(1)
  })

  // K9: UI interaction (jsdom): add 2 rows, paste 3 rows (1 invalid), no localStorage
  it('K9: UI adds rows, parses pasted list (skipping invalid line), renders format error, and stores nothing in localStorage', async () => {
    localStorage.clear()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const mockDocxBytes = await createW14FixtureDocx()

    act(() => {
      root.render(
        <WordAnonymizerPage
          account={mockAccount}
          apiUser={null}
          authReady={true}
          onSignInMicrosoft={vi.fn()}
          log={vi.fn()}
        />
      )
    })

    // Upload file
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([mockDocxBytes], 'test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
      writable: true,
    })

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
    })

    // Find "Thêm từ khoá" button and click 2 times
    const buttons = Array.from(container.querySelectorAll('button'))
    const addKeywordBtn = buttons.find((b) => b.textContent?.includes('Thêm từ khoá'))!
    expect(addKeywordBtn).toBeDefined()

    await act(async () => {
      addKeywordBtn.click()
      addKeywordBtn.click()
    })

    let keywordInputs = Array.from(
      container.querySelectorAll('.keyword-row input[placeholder="Từ khoá tìm kiếm"]')
    ) as HTMLInputElement[]
    expect(keywordInputs.length).toBe(2)

    // Open paste box
    const pasteBtn = buttons.find((b) => b.textContent?.includes('Dán danh sách'))!
    await act(async () => {
      pasteBtn.click()
    })

    const textarea = container.querySelector('.keyword-paste-textarea') as HTMLTextAreaElement
    expect(textarea).toBeDefined()

    // Paste 3 lines (line 3 is invalid: only 1 char 'X')
    const pasteContent = `Giám đốc => Người điều hành\nDự án Mẫu Thử => Dự án A\nX`
    await act(async () => {
      setTextareaValue(textarea, pasteContent)
      await new Promise((r) => setTimeout(r, 50))
    })

    const applyPasteBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Thêm vào danh sách')
    )!
    await act(async () => {
      applyPasteBtn.click()
    })

    // We should now have 4 valid rows (2 manual + 2 valid pasted)
    keywordInputs = Array.from(
      container.querySelectorAll('.keyword-row input[placeholder="Từ khoá tìm kiếm"]')
    ) as HTMLInputElement[]
    expect(keywordInputs.length).toBe(4)

    // Check error message for the 1 malformed line
    const pasteError = container.querySelector('.keyword-paste-error')
    expect(pasteError?.textContent).toContain('1 dòng sai định dạng')

    // Verify localStorage has NO keyword stored
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || ''
      const val = localStorage.getItem(key) || ''
      expect(key).not.toContain('keyword')
      expect(key).not.toContain('Giám đốc')
      expect(val).not.toContain('Giám đốc')
    }

    root.unmount()
    container.remove()
  }, 15000)

  // K11: End-to-end check with title, auth power of attorney, project name in body + Track Changes + comment
  it('K11: end-to-end mock docx with title, power of attorney, and project name in body + Track Changes + comment all replaced, residual PASS', async () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${OOXML_NAMESPACES.w}">
  <w:body>
    <w:p>
      <w:r><w:t>Chức danh: Giám đốc điều hành theo Giấy Ủy Quyền số 01/2026/UQ-TEST.</w:t></w:r>
    </w:p>
    <w:p>
      <w:del w:id="1" w:author="Author 1">
        <w:r><w:delText>Dự án Mẫu Thử đã bị hủy bỏ bởi Giám đốc điều hành.</w:delText></w:r>
      </w:del>
    </w:p>
  </w:body>
</w:document>`

    const comments = [
      {
        id: 1,
        author: 'Author 1',
        initials: 'A1',
        text: 'Kiểm tra lại Dự án Mẫu Thử và Giấy Ủy Quyền số 01/2026/UQ-TEST của Giám đốc điều hành.',
      },
    ]

    const fixtureBuffer = await createMockDocx({
      documentXmlOverride: docXml,
      comments,
    })

    const keywordRules: KeywordRule[] = [
      { id: 'k1', find: 'Giám đốc điều hành', replace: 'Lãnh đạo điều hành' },
      { id: 'k2', find: 'Giấy Ủy Quyền số 01/2026/UQ-TEST', replace: 'GUQ-01' },
      { id: 'k3', find: 'Dự án Mẫu Thử', replace: 'Dự án X' },
    ]

    const result = await anonymizeDocx(fixtureBuffer, mapping, {
      keywordRules,
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const outputDocXml = await zip.file('word/document.xml')!.async('string')
    const outputCommentsXml = await zip.file('word/comments.xml')!.async('string')

    expect(outputDocXml).not.toContain('Giám đốc điều hành')
    expect(outputDocXml).not.toContain('Giấy Ủy Quyền số 01/2026/UQ-TEST')
    expect(outputDocXml).not.toContain('Dự án Mẫu Thử')

    expect(outputCommentsXml).not.toContain('Giám đốc điều hành')
    expect(outputCommentsXml).not.toContain('Giấy Ủy Quyền số 01/2026/UQ-TEST')
    expect(outputCommentsXml).not.toContain('Dự án Mẫu Thử')

    expect(outputDocXml).toContain('Lãnh đạo điều hành')
    expect(outputDocXml).toContain('GUQ-01')
    expect(outputDocXml).toContain('Dự án X')

    const residual = await scanResidual(
      await result.blob.arrayBuffer(),
      [{ author: 'Author 1', kind: 'contributor', sources: [] }],
      [],
      { keywordRules }
    )
    expect(residual.status).toBe('PASS')
    expect(residual.findings.length).toBe(0)
  })
})
