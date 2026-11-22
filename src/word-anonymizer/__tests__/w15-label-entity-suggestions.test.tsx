import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  suggestFromLabels,
  inspectDocx,
  anonymizeDocx,
  scanResidual,
  type SuggestParagraph,
  type CustomEntity,
  type KeywordRule,
} from '../core'
import WordAnonymizerPage from '../WordAnonymizerPage'
import { createW15FixtureDocx } from './fixtures'
import type { AccountInfo } from '@azure/msal-browser'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mockAccount: AccountInfo = {
  homeAccountId: 'test-home-id',
  environment: 'login.microsoftonline.com',
  tenantId: 'test-tenant-id',
  username: 'tester@example.com',
  localAccountId: 'test-local-id',
  name: 'Tester User',
}

describe('W-15: Label-based Entity & Keyword Suggestions', () => {
  // K1: 8 lines from Vấn đề 1
  it('K1: suggests organization, representative, position, authorization accurately and ignores sensitive fields', () => {
    const paragraphs: SuggestParagraph[] = [
      { text: 'BÊN A:\tKHÁCH HÀNG CÔNG TY TNHH MẪU THỬ', source: 'body' },
      { text: 'Đại diện:\tBà NGƯỜI ĐẠI DIỆN TEST 01\tChức vụ: Giám đốc', source: 'body' },
      { text: 'Địa chỉ:\tSố 1 Đường Test, Phường Mẫu, Hà Nội', source: 'body' },
      { text: 'Điện thoại:\t024 0000 0000', source: 'body' },
      { text: 'Mã số thuế:\t0101234567', source: 'body' },
      { text: 'BÊN B:\tVIỆN ĐÀO TẠO MẪU THỬ', source: 'body' },
      { text: 'Đại diện:\tÔng NGƯỜI ĐẠI DIỆN TEST 02\tChức vụ: Giám đốc điều hành', source: 'body' },
      { text: '\t(Theo Giấy Ủy Quyền số 01/2026/UQ-TEST ngày 05/01/2026)', source: 'body' },
    ]

    const suggestions = suggestFromLabels(paragraphs)

    // Organizations
    const orgs = suggestions.filter((s) => s.kind === 'organization')
    expect(orgs.map((s) => s.value)).toEqual([
      'CÔNG TY TNHH MẪU THỬ',
      'VIỆN ĐÀO TẠO MẪU THỬ',
    ])

    // Representatives (without "Bà" or "Ông")
    const reps = suggestions.filter((s) => s.kind === 'representative')
    expect(reps.map((s) => s.value)).toEqual([
      'NGƯỜI ĐẠI DIỆN TEST 01',
      'NGƯỜI ĐẠI DIỆN TEST 02',
    ])

    // Positions
    const pos = suggestions.filter((s) => s.kind === 'keyword' && s.hint === 'position')
    expect(pos.map((s) => s.value)).toEqual([
      'Giám đốc',
      'Giám đốc điều hành',
    ])

    // Authorization
    const auth = suggestions.filter((s) => s.kind === 'keyword' && s.hint === 'authorization')
    expect(auth.map((s) => s.value)).toEqual([
      '01/2026/UQ-TEST',
    ])

    // Address, Phone, Tax code must NOT be suggested
    expect(suggestions.some((s) => s.value.includes('Số 1 Đường Test'))).toBe(false)
    expect(suggestions.some((s) => s.value.includes('024 0000 0000'))).toBe(false)
    expect(suggestions.some((s) => s.value.includes('0101234567'))).toBe(false)
    expect(suggestions).toHaveLength(7)
  })

  // K2: Negative test cases (regular sentence, placeholder)
  it('K2: does not suggest from non-label sentences or placeholder values', () => {
    const paragraphs: SuggestParagraph[] = [
      { text: 'Bên A có trách nhiệm thanh toán đúng thời hạn.', source: 'body' },
      { text: 'Đại diện các bên thống nhất ký kết hợp đồng.', source: 'body' },
      { text: 'Bên A: ........', source: 'body' },
      { text: 'Bên B: ___________', source: 'body' },
    ]

    const suggestions = suggestFromLabels(paragraphs)
    expect(suggestions).toEqual([])
  })

  // K3: Non-accented labels and values
  it('K3: correctly detects unaccented labels ("BEN A:", "Dai dien:", "Giay uy quyen so")', () => {
    const paragraphs: SuggestParagraph[] = [
      { text: 'BEN A: CONG TY TNHH MAU THU', source: 'body' },
      { text: 'Dai dien: Ong NGUOI DAI DIEN TEST', source: 'body' },
      { text: 'Giay uy quyen so 02/UQ-TEST ngay 01/01/2026', source: 'body' },
    ]

    const suggestions = suggestFromLabels(paragraphs)
    expect(suggestions.some((s) => s.value === 'CONG TY TNHH MAU THU' && s.kind === 'organization')).toBe(true)
    expect(suggestions.some((s) => s.value === 'NGUOI DAI DIEN TEST' && s.kind === 'representative')).toBe(true)
    expect(suggestions.some((s) => s.value === '02/UQ-TEST' && s.kind === 'keyword')).toBe(true)
  })

  // K4: Sources tracking (body vs deleted)
  it('K4: tracks sources correctly (only deleted, or both body and deleted)', () => {
    // 1. Only deleted
    const deletedParas: SuggestParagraph[] = [
      { text: 'BÊN A:\tCÔNG TY CỔ PHẦN CŨ', source: 'deleted' },
    ]
    const suggDeleted = suggestFromLabels(deletedParas)
    expect(suggDeleted).toHaveLength(1)
    expect(suggDeleted[0].sources).toEqual(['deleted'])
    expect(suggDeleted[0].count).toBe(1)

    // 2. Both body and deleted
    const bothParas: SuggestParagraph[] = [
      { text: 'BÊN A:\tCÔNG TY TNHH MẪU THỬ', source: 'body' },
      { text: 'BÊN A:\tCÔNG TY TNHH MẪU THỬ', source: 'deleted' },
    ]
    const suggBoth = suggestFromLabels(bothParas)
    expect(suggBoth).toHaveLength(1)
    expect(suggBoth[0].count).toBe(2)
    expect(suggBoth[0].sources).toContain('body')
    expect(suggBoth[0].sources).toContain('deleted')
  })

  // K5: Deduplication and count aggregation
  it('K5: aggregates multiple occurrences into one suggestion with count = 3', () => {
    const paragraphs: SuggestParagraph[] = [
      { text: 'Đại diện:\tBà NGUYỄN THỊ TEST', source: 'body' },
      { text: 'Đại diện:\tBà NGUYỄN THỊ TEST', source: 'body' },
      { text: 'Người đại diện:\tBà NGUYỄN THỊ TEST', source: 'body' },
    ]

    const suggestions = suggestFromLabels(paragraphs)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].value).toBe('NGUYỄN THỊ TEST')
    expect(suggestions[0].count).toBe(3)
  })

  // K6: UI interaction and end-to-end integration test
  it('K6: UI renders 7 suggestions, positions unticked by default, accepts selected into entities & keywords, anonymizes completely with PASS residual', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const fixtureBytes = await createW15FixtureDocx()

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

    // Simulate file upload
    const file = new File([fixtureBytes], 'test-w15-contract.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      configurable: true,
      writable: true,
    })

    await act(async () => {
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
    })

    // Verify 7 suggestions rendered
    const suggestionBlock = container.querySelector('.suggestions-block')
    expect(suggestionBlock).not.toBeNull()
    const suggestionItems = container.querySelectorAll('.suggestion-item')
    expect(suggestionItems).toHaveLength(7)

    // Verify "Chức vụ" checkboxes are NOT checked, while others are checked
    const checkboxes = Array.from(container.querySelectorAll('.suggestion-item input[type="checkbox"]')) as HTMLInputElement[]
    expect(checkboxes).toHaveLength(7)

    // Check default checked states
    suggestionItems.forEach((item) => {
      const badge = item.querySelector('.suggestion-kind-badge')
      const cb = item.querySelector('input[type="checkbox"]') as HTMLInputElement
      if (badge?.textContent?.includes('Chức vụ')) {
        expect(cb.checked).toBe(false)
      } else {
        expect(cb.checked).toBe(true)
      }
    })

    // Click "Thêm các mục đã chọn" button
    const addSelectedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Thêm các mục đã chọn')
    )
    expect(addSelectedBtn).toBeDefined()

    await act(async () => {
      addSelectedBtn?.click()
      await new Promise((r) => setTimeout(r, 100))
    })

    // After adding 5 items (2 orgs, 2 reps, 1 auth), remaining suggestions should be 2 (the 2 position items)
    const remainingItems = container.querySelectorAll('.suggestion-item')
    expect(remainingItems).toHaveLength(2)

    // Verify entities added
    const entityRows = container.querySelectorAll('.entity-row')
    expect(entityRows).toHaveLength(4) // 2 orgs + 2 reps

    // Verify keyword added
    const keywordRows = container.querySelectorAll('.keyword-row')
    expect(keywordRows).toHaveLength(1) // 1 auth keyword

    // Now verify end-to-end anonymization with these accepted entities & keywords
    const report = await inspectDocx(fixtureBytes)
    expect(report.suggestions).toHaveLength(7)

    // Accept selected (same as UI logic)
    const acceptedEntities: CustomEntity[] = [
      { id: 'org-1', kind: 'organization', label: 'Pháp nhân A', values: ['CÔNG TY TNHH MẪU THỬ'] },
      { id: 'org-2', kind: 'organization', label: 'Pháp nhân B', values: ['VIỆN ĐÀO TẠO MẪU THỬ'] },
      { id: 'rep-1', kind: 'representative', label: 'Người đại diện 1', values: ['NGƯỜI ĐẠI DIỆN TEST 01'] },
      { id: 'rep-2', kind: 'representative', label: 'Người đại diện 2', values: ['NGƯỜI ĐẠI DIỆN TEST 02'] },
    ]
    const acceptedKeywords: KeywordRule[] = [
      { id: 'kw-1', find: '01/2026/UQ-TEST', replace: '[Số giấy uỷ quyền]' },
    ]

    const anonymized = await anonymizeDocx(
      fixtureBytes,
      {},
      {
        customEntities: acceptedEntities,
        keywordRules: acceptedKeywords,
      }
    )

    const anonymizedBuffer = await anonymized.blob.arrayBuffer()
    const residual = await scanResidual(
      anonymizedBuffer,
      [],
      acceptedEntities,
      { keywordRules: acceptedKeywords }
    )

    expect(residual.status).toBe('PASS')
    expect(residual.findings).toHaveLength(0)

    document.body.removeChild(container)
  })

  // K7: Performance test: 2,000 paragraphs in < 100 ms (median of 3 runs, after warm-up)
  it('K7: processes 2,000 paragraphs in < 100 ms (median of 3 runs with warmup)', () => {
    const sampleTemplates = [
      'BÊN A:\tKHÁCH HÀNG CÔNG TY TNHH MẪU THỬ',
      'Đại diện:\tBà NGƯỜI ĐẠI DIỆN TEST 01\tChức vụ: Giám đốc',
      'Địa chỉ:\tSố 1 Đường Test, Phường Mẫu, Hà Nội',
      'Điện thoại:\t024 0000 0000',
      'Mã số thuế:\t0101234567',
      'BÊN B:\tVIỆN ĐÀO TẠO MẪU THỬ',
      'Đại diện:\tÔng NGƯỜI ĐẠI DIỆN TEST 02\tChức vụ: Giám đốc điều hành',
      '(Theo Giấy Ủy Quyền số 01/2026/UQ-TEST ngày 05/01/2026)',
      'Hợp đồng số 123/2026/HĐ-TEST ngày 10/01/2026',
      'Điều 1: Bên A có trách nhiệm thanh toán đúng thời hạn và Bên B bàn giao tài liệu.',
    ]

    const largeParagraphs: SuggestParagraph[] = []
    for (let i = 0; i < 2000; i++) {
      largeParagraphs.push({
        text: sampleTemplates[i % sampleTemplates.length],
        source: i % 5 === 0 ? 'deleted' : 'body',
      })
    }
    expect(largeParagraphs).toHaveLength(2000)

    // Warm-up run
    suggestFromLabels(largeParagraphs)

    // 3 timed runs
    const times: number[] = []
    for (let run = 0; run < 3; run++) {
      const start = performance.now()
      suggestFromLabels(largeParagraphs)
      const end = performance.now()
      times.push(end - start)
    }

    times.sort((a, b) => a - b)
    const medianTime = times[1]

    // Expect median time to be well below 100ms
    expect(medianTime).toBeLessThan(100)
  })
})
