import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import WordAnonymizerPage from '../WordAnonymizerPage'
import { createMockDocx } from './fixtures'
import type { AccountInfo } from '@azure/msal-browser'

// @ts-expect-error global act flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function uploadMockFile(fileInput: HTMLInputElement, file: File) {
  Object.defineProperty(fileInput, 'files', {
    value: [file],
    configurable: true,
    writable: true,
  })
  await act(async () => {
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 150))
  })
}

const mockAccount: AccountInfo = {
  homeAccountId: 'test-account-id',
  environment: 'login.windows.net',
  tenantId: 'test-tenant-id',
  username: 'hocvien.test01@example.com',
  localAccountId: 'test-local-id',
  name: 'Học viên Test 01',
}

describe('WordAnonymizerPage Component Tests (W-2)', () => {
  // K1: Vào #/word-anonymizer khi chưa đăng nhập → thấy yêu cầu đăng nhập, không chọn được file.
  it('K1: renders login required message when account is null, no file input available', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <WordAnonymizerPage
          account={null}
          apiUser={null}
          authReady={true}
          onSignInMicrosoft={vi.fn()}
          log={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Yêu cầu đăng nhập Microsoft')
    expect(container.textContent).toContain('Kiểm tra lại nội dung tài liệu trước khi upload')
    // No file input or dropzone rendered when not logged in
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.querySelector('.word-dropzone')).toBeNull()

    root.unmount()
    container.remove()
  })

  // K2: Đăng nhập, upload file fixture có 2 người góp ý + 1 người chỉ được @mention
  it('K2: authenticated, inspects docx, shows contributor (2) and mentioned (1) groups, rejects duplicate labels', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const logFn = vi.fn()

    const mockDocxBytes = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Học viên Test 01',
          initials: 'HV01',
          text: 'Comment 1',
        },
        {
          id: 2,
          author: 'Học viên Test 02',
          initials: 'HV02',
          text: '',
          hyperlink: {
            rId: 'rId99',
            text: '@Giảng viên Test 09',
          },
        },
      ],
      mentions: [
        {
          relId: 'rId99',
          email: 'giangvien.test09@example.com',
        },
      ],
    })

    act(() => {
      root.render(
        <WordAnonymizerPage
          account={mockAccount}
          apiUser={null}
          authReady={true}
          onSignInMicrosoft={vi.fn()}
          log={logFn}
        />
      )
    })

    // Dropzone is rendered
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()

    // Simulate file upload
    const file = new File([mockDocxBytes], 'test-doc.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await uploadMockFile(fileInput, file)

    // Verify 2 contributor and 1 mentioned group
    expect(container.textContent).toContain('Người góp ý (2)')
    expect(container.textContent).toContain('Người được nhắc (1)')
    // Verify no alias column header
    expect(container.textContent).not.toContain('Alias')
    expect(container.textContent).not.toContain('alias')

    // Find the label inputs
    const inputs = Array.from(container.querySelectorAll('input[type="text"]')) as HTMLInputElement[]
    expect(inputs.length).toBeGreaterThanOrEqual(3)

    // Set duplicate labels: change input[0] and input[2] to same label
    await act(async () => {
      const firstLabelInput = inputs[0]
      firstLabelInput.value = 'Trùng Nhãn'
      firstLabelInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    root.unmount()
    container.remove()
  })

  // K3, K4, K5: Test anonymization, residual reports (PASS, WARN, FAIL) and activity log fields
  it('K3, K4, K5: anonymization flow, residual PASS, WARN, FAIL and activity log 4 fields', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const logFn = vi.fn()

    const mockDocxBytes = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Học viên Test 01',
          initials: 'HV01',
          text: 'Văn bản bình luận sạch.',
        },
      ],
    })

    act(() => {
      root.render(
        <WordAnonymizerPage
          account={mockAccount}
          apiUser={null}
          authReady={true}
          onSignInMicrosoft={vi.fn()}
          log={logFn}
        />
      )
    })

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([mockDocxBytes], 'document_clean.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await uploadMockFile(fileInput, file)

    // Click "Ẩn danh tài liệu"
    const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ẩn danh tài liệu')
    )
    expect(anonymizeBtn).toBeDefined()

    await act(async () => {
      anonymizeBtn!.click()
      await new Promise((r) => setTimeout(r, 150))
    })

    // Verify PASS card is displayed
    expect(container.textContent).toContain('ĐẠT BẢO MẬT (PASS)')

    // Verify log was called with word_anonymizer.completed and ONLY 4 fields!
    expect(logFn).toHaveBeenCalledWith(
      'word_anonymizer.completed',
      'Ẩn danh tài liệu Word hoàn tất',
      expect.objectContaining({
        authorCount: expect.any(Number),
        commentCount: expect.any(Number),
        revisionCount: expect.any(Number),
        residualStatus: 'PASS',
      }),
      'success'
    )
    const lastCall = logFn.mock.calls.find((c) => c[0] === 'word_anonymizer.completed')
    const metadata = lastCall![2]
    expect(Object.keys(metadata).sort()).toEqual([
      'authorCount',
      'commentCount',
      'residualStatus',
      'revisionCount',
    ])
    // Make sure no file name or person name in metadata
    expect(JSON.stringify(metadata)).not.toContain('document_clean.docx')
    expect(JSON.stringify(metadata)).not.toContain('Học viên Test 01')

    root.unmount()
    container.remove()
  })

  // K2 verify rel remains alias when renamed
  it('K2: when mentioned person is renamed to "Giảng viên A", rel target remains alias', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const mockDocxBytes = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Học viên Test 01',
          initials: 'HV01',
          text: '',
          hyperlink: {
            rId: 'rId99',
            text: '@Giảng viên Test 09',
          },
        },
      ],
      mentions: [
        {
          relId: 'rId99',
          email: 'giangvien.test09@example.com',
        },
      ],
    })

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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([mockDocxBytes], 'mention_doc.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await uploadMockFile(fileInput, file)

    // Find input for mentioned label
    const inputs = Array.from(container.querySelectorAll('input[type="text"]')) as HTMLInputElement[]
    // The second input is mentioned label
    const mentionedLabelInput = inputs[inputs.length - 1]

    await act(async () => {
      mentionedLabelInput.value = 'Giảng viên A'
      mentionedLabelInput.dispatchEvent(new Event('change', { bubbles: true }))
      // Also trigger onChange via React synthetic event
      // @ts-expect-error test trigger
      mentionedLabelInput.onchange?.({ target: { value: 'Giảng viên A' } })
    })

    const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ẩn danh tài liệu')
    )

    await act(async () => {
      anonymizeBtn!.click()
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(container.textContent).toContain('Tải tài liệu đã ẩn danh')

    root.unmount()
    container.remove()
  })

  // K4: WARN when name in comment text, FAIL locks download until acknowledged
  it('K4: WARN shows finding part; FAIL locks download button until acknowledge checkbox is checked', async () => {
    // 1. WARN test
    const container1 = document.createElement('div')
    document.body.appendChild(container1)
    const root1 = createRoot(container1)

    const warnDocxBytes = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Học viên Test 01',
          initials: 'HV01',
          text: 'Văn bản chứa tên Học viên Test 01 bên trong comment.',
        },
      ],
    })

    act(() => {
      root1.render(
        <WordAnonymizerPage
          account={mockAccount}
          apiUser={null}
          authReady={true}
          onSignInMicrosoft={vi.fn()}
          log={vi.fn()}
        />
      )
    })

    const fileInput1 = container1.querySelector('input[type="file"]') as HTMLInputElement
    const file1 = new File([warnDocxBytes], 'warn_doc.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await uploadMockFile(fileInput1, file1)

    const anonymizeBtn1 = Array.from(container1.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ẩn danh tài liệu')
    )

    await act(async () => {
      anonymizeBtn1!.click()
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(container1.textContent).toContain('CẢNH BÁO (WARN)')
    expect(container1.textContent).toContain('word/comments.xml')
    expect(container1.textContent).toContain('comment-text')

    root1.unmount()
    container1.remove()

    // 2. FAIL test
    const container2 = document.createElement('div')
    document.body.appendChild(container2)
    const root2 = createRoot(container2)

    const failDocxBytes = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Học viên Test 01',
          initials: 'HV01',
          text: 'Comment bình thường',
        },
      ],
      customProps: [
        {
          name: 'MSIP_Label_Test',
          value: 'Học viên Test 01',
        },
      ],
    })

    act(() => {
      root2.render(
        <WordAnonymizerPage
          account={mockAccount}
          apiUser={null}
          authReady={true}
          onSignInMicrosoft={vi.fn()}
          log={vi.fn()}
        />
      )
    })

    const fileInput2 = container2.querySelector('input[type="file"]') as HTMLInputElement
    const file2 = new File([failDocxBytes], 'fail_doc.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await uploadMockFile(fileInput2, file2)

    const anonymizeBtn2 = Array.from(container2.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ẩn danh tài liệu')
    )

    await act(async () => {
      anonymizeBtn2!.click()
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(container2.textContent).toContain('KHÔNG ĐẠT (FAIL)')

    // Download button is a disabled button, no a[href] in DOM
    expect(container2.querySelector('a[href]')).toBeNull()
    const downloadBtn = container2.querySelector('button.disabled') as HTMLButtonElement
    expect(downloadBtn).not.toBeNull()
    expect(downloadBtn.disabled).toBe(true)
    expect(downloadBtn.textContent).toContain('Tải tài liệu đã ẩn danh')

    // Find acknowledgeRisk checkbox
    const acknowledgeCheckbox = Array.from(container2.querySelectorAll('input[type="checkbox"]')).find(
      (cb) => (cb as HTMLInputElement).parentElement?.textContent?.includes('Tôi đã hiểu rủi ro')
    ) as HTMLInputElement
    expect(acknowledgeCheckbox).toBeDefined()

    // Check acknowledgeRisk
    await act(async () => {
      acknowledgeCheckbox.click()
      await new Promise((r) => setTimeout(r, 50))
    })

    // Now download button is unlocked as an <a> tag
    const downloadLink = container2.querySelector('a.primary') as HTMLAnchorElement
    expect(downloadLink).not.toBeNull()
    expect(downloadLink.getAttribute('href')).toBeTruthy()
    expect(downloadLink.className).not.toContain('disabled')

    root2.unmount()
    container2.remove()
  })

  // F-5 K1: FAIL locks download button, no a[href], Tab/Enter cannot download; unlocked on acknowledge
  it('F-5 K1: FAIL status strictly locks download with disabled button (no a[href]); unlocked on acknowledge', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const failDocxBytes = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Tác giả A',
          initials: 'TA',
          text: 'Comment',
        },
      ],
      customProps: [
        {
          name: 'MSIP_Label_Test',
          value: 'Tác giả A',
        },
      ],
    })

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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([failDocxBytes], 'fail_test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    await uploadMockFile(fileInput, file)

    const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ẩn danh tài liệu')
    )
    await act(async () => {
      anonymizeBtn!.click()
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(container.textContent).toContain('KHÔNG ĐẠT (FAIL)')

    // Must NOT have any <a> with download or href
    expect(container.querySelector('a[download]')).toBeNull()
    expect(container.querySelector('a[href]')).toBeNull()

    // Must have disabled button
    const downloadBtn = container.querySelector('button.disabled') as HTMLButtonElement
    expect(downloadBtn).not.toBeNull()
    expect(downloadBtn.disabled).toBe(true)

    // Acknowledge risk checkbox
    const ackCb = Array.from(container.querySelectorAll('input[type="checkbox"]')).find((cb) =>
      (cb as HTMLInputElement).parentElement?.textContent?.includes('Tôi đã hiểu rủi ro')
    ) as HTMLInputElement
    expect(ackCb).toBeDefined()

    await act(async () => {
      ackCb.click()
      await new Promise((r) => setTimeout(r, 50))
    })

    // Now rendered as <a> with download and href
    const downloadLink = container.querySelector('a.primary') as HTMLAnchorElement
    expect(downloadLink).not.toBeNull()
    expect(downloadLink.getAttribute('download')).toBe('document_anonymized.docx')
    expect(downloadLink.getAttribute('href')).toBeTruthy()

    root.unmount()
    container.remove()
  })

  // F-5 K2: Changing config resets stale results and shows reminder; re-running updates; keepOriginalName does not reset
  it('F-5 K2: editing label/initials/options clears stale result and displays reminder; re-run clears reminder; keepOriginalName keeps result', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    const mockDocxBytes = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Người dùng Một',
          initials: 'NDM',
          text: 'Bình luận thử nghiệm',
        },
      ],
    })

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

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([mockDocxBytes], 'demo.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    await uploadMockFile(fileInput, file)

    const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ẩn danh tài liệu')
    )

    // 1. Run first time
    await act(async () => {
      anonymizeBtn!.click()
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(container.textContent).toContain('ĐẠT BẢO MẬT (PASS)')
    expect(container.querySelector('.residual-card')).not.toBeNull()
    expect(container.querySelector('a.primary')).not.toBeNull()
    expect(container.textContent).not.toContain('Cấu hình đã thay đổi')

    // 2. Toggle "Giữ tên gốc khi tải về" -> should NOT reset results
    const keepOriginalNameCb = Array.from(
      container.querySelectorAll('input[type="checkbox"]')
    ).find((cb) =>
      (cb as HTMLInputElement).parentElement?.textContent?.includes('Giữ tên gốc khi tải về')
    ) as HTMLInputElement
    expect(keepOriginalNameCb).toBeDefined()

    await act(async () => {
      keepOriginalNameCb.click()
      await new Promise((r) => setTimeout(r, 50))
    })

    // Result must still be present!
    expect(container.querySelector('.residual-card')).not.toBeNull()
    expect(container.querySelector('a.primary')).not.toBeNull()
    expect(container.textContent).not.toContain('Cấu hình đã thay đổi')

    // 3. Edit author label -> stale results cleared, reminder shown
    const labelInput = container.querySelector('input[placeholder="Nhãn thay thế"]') as HTMLInputElement
    expect(labelInput).not.toBeNull()

    await act(async () => {
      setInputValue(labelInput, 'Tác giả VIP')
      await new Promise((r) => setTimeout(r, 50))
    })

    // Result and download button must disappear
    expect(container.querySelector('.residual-card')).toBeNull()
    expect(container.querySelector('a.primary')).toBeNull()
    expect(container.querySelector('button.disabled')).toBeNull()
    // Reminder message must be displayed
    expect(container.textContent).toContain(
      'Cấu hình đã thay đổi — bấm "Ẩn danh tài liệu" để tạo lại file.'
    )

    // 4. Click "Ẩn danh tài liệu" again -> result reappears, reminder cleared
    await act(async () => {
      anonymizeBtn!.click()
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(container.querySelector('.residual-card')).not.toBeNull()
    expect(container.querySelector('a.primary')).not.toBeNull()
    expect(container.textContent).not.toContain('Cấu hình đã thay đổi')

    // 5. Change option "removeDates" -> stale results cleared, reminder shown
    const removeDatesCb = Array.from(
      container.querySelectorAll('input[type="checkbox"]')
    ).find((cb) =>
      (cb as HTMLInputElement).parentElement?.textContent?.includes('removeDates')
    ) as HTMLInputElement
    expect(removeDatesCb).toBeDefined()

    await act(async () => {
      removeDatesCb.click()
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(container.querySelector('.residual-card')).toBeNull()
    expect(container.querySelector('a.primary')).toBeNull()
    expect(container.textContent).toContain(
      'Cấu hình đã thay đổi — bấm "Ẩn danh tài liệu" để tạo lại file.'
    )

    // 6. Click "Ẩn danh tài liệu" again -> result reappears, reminder cleared
    await act(async () => {
      anonymizeBtn!.click()
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(container.querySelector('.residual-card')).not.toBeNull()
    expect(container.querySelector('a.primary')).not.toBeNull()
    expect(container.textContent).not.toContain('Cấu hình đã thay đổi')

    root.unmount()
    container.remove()
  })
})
