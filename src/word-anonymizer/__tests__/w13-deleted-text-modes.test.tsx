import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import {
  anonymizeDocx,
  scanResidual,
  parseXml,
  CustomEntity,
  IdentityMapping,
  OOXML_NAMESPACES,
} from '../core'
import WordAnonymizerPage from '../WordAnonymizerPage'
import { createW13FixtureDocx } from './fixtures'
import type { AccountInfo } from '@azure/msal-browser'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mockAccount: AccountInfo = {
  homeAccountId: 'test-account-id',
  environment: 'login.windows.net',
  tenantId: 'test-tenant-id',
  username: 'hocvien.test01@example.com',
  localAccountId: 'test-local-id',
  name: 'Học viên Test 01',
}

const customEntities: CustomEntity[] = [
  {
    id: 'ent-1',
    kind: 'organization',
    label: 'Pháp nhân A',
    values: ['Công ty TNHH Mẫu Thử'],
  },
]

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

describe('W-13: Deleted text handling modes (mask, remove, keep)', () => {
  // K1: mask mode (default without passing deletedTextMode option)
  it('K1: mask mode (default) masks delText across runs, preserves w:del, residual PASS', async () => {
    const fixtureBuffer = await createW13FixtureDocx()

    // Run anonymization with default options (no deletedTextMode specified)
    const result = await anonymizeDocx(fixtureBuffer, mapping, {
      customEntities,
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)

    // Check w:t "Bên A: " is intact
    const tNodes = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
    const tCombined = tNodes.map((n) => n.textContent || '').join('')
    expect(tCombined).toContain('Bên A: ')

    // Number of w:del elements preserved (2 in fixture F)
    const delEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'del'))
    expect(delEls.length).toBe(2)

    // Check delText joined content:
    const delTexts = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
    const delCombined = delTexts.map((n) => n.textContent || '').join('')

    expect(delCombined).toContain('Pháp nhân A')
    expect(delCombined).toContain('09******78')
    expect(delCombined).toContain('*******567')
    expect(delCombined).toContain('****, Hà Nội')

    // Original sensitive data should NOT exist in delText
    expect(delCombined).not.toContain('Mẫu Thử')
    expect(delCombined).not.toContain('0912 345 678')
    expect(delCombined).not.toContain('0101234567')

    // Residual scan must be PASS
    const residual = await scanResidual(
      await result.blob.arrayBuffer(),
      [{ author: 'Author 1', kind: 'contributor', sources: [] }],
      [...customEntities, '0912 345 678', '0101234567', 'Số 1 Đường Test, Hà Nội']
    )
    expect(residual.status).toBe('PASS')
    expect(residual.findings.length).toBe(0)
  })

  // K2: remove mode
  it('K2: remove mode removes w:del with delText, counts deletedRunsRemoved >= 2, valid XML, residual PASS', async () => {
    const fixtureBuffer = await createW13FixtureDocx()

    const result = await anonymizeDocx(fixtureBuffer, mapping, {
      customEntities,
      deletedTextMode: 'remove',
    })

    expect(result.report.replacements.deletedRunsRemoved).toBeGreaterThanOrEqual(2)

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)

    // No w:delText should remain in document.xml
    const delTexts = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
    expect(delTexts.length).toBe(0)

    // "Bên A: " still remains
    const tNodes = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
    const tCombined = tNodes.map((n) => n.textContent || '').join('')
    expect(tCombined).toContain('Bên A: ')

    // Document must have valid body
    const body = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'body')
    expect(body.length).toBe(1)

    // Residual scan must be PASS
    const residual = await scanResidual(
      await result.blob.arrayBuffer(),
      [{ author: 'Author 1', kind: 'contributor', sources: [] }],
      [...customEntities, '0912 345 678', '0101234567']
    )
    expect(residual.status).toBe('PASS')
  })

  // K3: keep mode
  it('K3: keep mode preserves original w:delText, residual status is PASS (findings marked deleted-text)', async () => {
    const fixtureBuffer = await createW13FixtureDocx()

    const result = await anonymizeDocx(fixtureBuffer, mapping, {
      customEntities,
      deletedTextMode: 'keep',
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)

    const delTexts = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
    const delCombined = delTexts.map((n) => n.textContent || '').join('')

    // Original text is kept untouched
    expect(delCombined).toContain('Công ty TNHH Mẫu Thử')
    expect(delCombined).toContain('0912 345 678')
    expect(delCombined).toContain('0101234567')

    // Residual scan with deletedTextMode: 'keep' should NOT escalate to WARN or FAIL
    const residual = await scanResidual(
      await result.blob.arrayBuffer(),
      [{ author: 'Author 1', kind: 'contributor', sources: [] }],
      [...customEntities, '0912 345 678'],
      { deletedTextMode: 'keep' }
    )

    expect(residual.status).toBe('PASS')
    expect(residual.findings.length).toBeGreaterThan(0)
    for (const f of residual.findings) {
      expect(f.category).toBe('deleted-text')
    }
  })

  // K4: mask in comments.xml and header1.xml
  it('K4: mask mode masks delText in comments.xml and header1.xml', async () => {
    const fixtureBuffer = await createW13FixtureDocx({
      commentsDelText: 'Liên hệ SĐT đã xoá: 0912 345 678',
      headerDelText: 'Header SĐT cũ: 0912 345 678',
    })

    const result = await anonymizeDocx(fixtureBuffer, mapping, {
      customEntities,
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    // Check comments.xml
    const commentsXml = await zip.file('word/comments.xml')!.async('string')
    expect(commentsXml).toContain('09******78')
    expect(commentsXml).not.toContain('0912 345 678')

    // Check header1.xml
    const headerXml = await zip.file('word/header1.xml')!.async('string')
    expect(headerXml).toContain('09******78')
    expect(headerXml).not.toContain('0912 345 678')
  })

  // K5: NFD decomposed text in delText
  it('K5: matches entity even when delText is decomposed NFD', async () => {
    // "Mẫu Thử" in NFD
    const nfdMauThu = 'Mẫu Thử'.normalize('NFD')
    const fixtureBuffer = await createW13FixtureDocx({
      delTextRuns: ['Công ty TNHH ', nfdMauThu],
      secondDelText: '',
    })

    const result = await anonymizeDocx(fixtureBuffer, mapping, {
      customEntities,
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)

    const delTexts = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
    const delCombined = delTexts.map((n) => n.textContent || '').join('')

    expect(delCombined).toContain('Pháp nhân A')
    expect(delCombined).not.toContain('Mẫu Thử')
  })

  // K6: Entity split across 3 delText runs in same paragraph
  it('K6: entity split across 3 delText runs is replaced exactly once without leftover fragments', async () => {
    const fixtureBuffer = await createW13FixtureDocx({
      delTextRuns: ['Công ty ', 'TNHH ', 'Mẫu Thử'],
      secondDelText: '',
    })

    const result = await anonymizeDocx(fixtureBuffer, mapping, {
      customEntities,
      deletedTextMode: 'mask',
    })

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const docXml = await zip.file('word/document.xml')!.async('string')
    const doc = parseXml(docXml)

    const delTexts = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
    const delCombined = delTexts.map((n) => n.textContent || '').join('')

    expect(delCombined).toContain('Pháp nhân A')
    expect(delCombined).not.toContain('Công ty')
    expect(delCombined).not.toContain('TNHH')
    expect(delCombined).not.toContain('Mẫu Thử')
    expect(result.report.replacements.entities).toBe(1)
  })

  // K7: UI tests for radio buttons and warning text
  it('K7: UI renders 3 radio options defaulting to "mask", changing to "keep" shows alert containing "KHÔNG"', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const mockDocxBytes = await createW13FixtureDocx()

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

    // Verify 3 radio buttons exist
    const radioInputs = Array.from(
      container.querySelectorAll('input[type="radio"][name="deletedTextMode"]')
    ) as HTMLInputElement[]
    expect(radioInputs.length).toBe(3)

    const radioValues = radioInputs.map((r) => r.value)
    expect(radioValues).toEqual(['mask', 'remove', 'keep'])

    // Default selected radio is 'mask' ("Che như chữ thường (khuyến nghị)")
    const maskRadio = radioInputs.find((r) => r.value === 'mask')!
    expect(maskRadio.checked).toBe(true)

    // With mask mode, alert is info ("Các nội dung sau trong chữ đã xoá sẽ được che/thay thế")
    expect(container.textContent).toContain('Các nội dung sau trong chữ đã xoá sẽ được che/thay thế')

    // Change to 'keep' ("Giữ nguyên (chỉ cảnh báo)")
    const keepRadio = radioInputs.find((r) => r.value === 'keep')!
    await act(async () => {
      keepRadio.click()
      keepRadio.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 100))
    })

    expect(keepRadio.checked).toBe(true)

    // In 'keep' mode, warning must contain "KHÔNG"
    expect(container.textContent).toContain('KHÔNG')

    root.unmount()
    container.remove()
  }, 15000)
})
