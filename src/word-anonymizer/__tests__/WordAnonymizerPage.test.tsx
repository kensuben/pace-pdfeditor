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

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

async function uploadMockFile(fileInput: HTMLInputElement, file: File) {
  Object.defineProperty(fileInput, 'files', {
    value: [file],
    configurable: true,
    writable: true,
  })
  await act(async () => {
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
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
    expect(container.textContent).toContain('Kiểm tra lại nội dung trước khi upload')
    const reminderLink = container.querySelector('.fixed-reminder-callout a[href="/huong-dan/#word"]')
    expect(reminderLink).not.toBeNull()
    expect(reminderLink?.getAttribute('target')).toBe('_blank')
    expect(reminderLink?.getAttribute('rel')).toBe('noopener')
    expect(reminderLink?.textContent).toBe('Xem hướng dẫn')
    // No file input or dropzone rendered when not logged in
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.querySelector('.word-dropzone')).toBeNull()

    root.unmount()
    container.remove()
  }, 15000)

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
  }, 15000)

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
      await new Promise((r) => setTimeout(r, 400))
    })

    // Verify PASS card is displayed
    expect(container.textContent).toContain('ĐẠT BẢO MẬT (PASS)')
    const residualLink = container.querySelector('.word-card-header a[href="/huong-dan/#ket-qua"]')
    expect(residualLink).not.toBeNull()
    expect(residualLink?.getAttribute('target')).toBe('_blank')
    expect(residualLink?.getAttribute('rel')).toBe('noopener')
    expect(residualLink?.textContent).toBe('Ý nghĩa kết quả')

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
      'addressMasked',
      'authorCount',
      'bankAccountMasked',
      'commentCount',
      'emailMasked',
      'entityReplacements',
      'nationalIdMasked',
      'phoneMasked',
      'residualStatus',
      'revisionCount',
      'taxCodeMasked',
    ])
    // Make sure no file name or person name in metadata
    expect(JSON.stringify(metadata)).not.toContain('document_clean.docx')
    expect(JSON.stringify(metadata)).not.toContain('Học viên Test 01')

    root.unmount()
    container.remove()
  }, 15000)

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
      await new Promise((r) => setTimeout(r, 400))
    })

    expect(container.textContent).toContain('Tải tài liệu đã ẩn danh')

    root.unmount()
    container.remove()
  }, 15000)

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
      await new Promise((r) => setTimeout(r, 400))
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
      await new Promise((r) => setTimeout(r, 400))
    })

    expect(container2.textContent).toContain('KHÔNG ĐẠT (FAIL)')

    // Download button is a disabled button, no download link in actions row
    expect(container2.querySelector('.word-actions-row a[href]')).toBeNull()
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
  }, 15000)

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
      await new Promise((r) => setTimeout(r, 400))
    })

    expect(container.textContent).toContain('KHÔNG ĐẠT (FAIL)')

    // Must NOT have any <a> with download or href in action row
    expect(container.querySelector('a[download]')).toBeNull()
    expect(container.querySelector('.word-actions-row a[href]')).toBeNull()

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
  }, 15000)

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
      await new Promise((r) => setTimeout(r, 400))
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
      await new Promise((r) => setTimeout(r, 400))
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
      await new Promise((r) => setTimeout(r, 400))
    })

    expect(container.querySelector('.residual-card')).not.toBeNull()
    expect(container.querySelector('a.primary')).not.toBeNull()
    expect(container.textContent).not.toContain('Cấu hình đã thay đổi')

    root.unmount()
    container.remove()
  }, 15000)

  // ==========================================
  // Part B: Entities & Sensitive Data Masking UI (W-5b)
  // ==========================================
  describe('WordAnonymizerPage Part B (W-5b)', () => {
    const fixtureText = `
Hợp đồng hợp tác giữa Công ty TNHH Mẫu Thử và đối tác chiến lược.
Mau Thu Co., Ltd do Người Đại Diện Test 01 đại diện theo pháp luật.
Thông tin liên hệ email: test1@example.com và contact@example.com.
Hotline di động: 0912345678, số hỗ trợ 0987654321, số phụ 0901234567.
Người đại diện có CCCD 001099012345 cấp bởi Cục CSQLHC về TTXH.
Mã số thuế doanh nghiệp: MST: 0101234567-001 đăng ký tại Hà Nội.
Tài khoản thanh toán: STK 19031234567890 mở tại Techcombank.
Trụ sở chính: Địa chỉ: Số 1 Đường Test, P. Bến Nghé, Quận 1, TP.HCM.
`

    // B1: Upload fixture giả -> thẻ phát hiện liệt kê đủ, đúng loại, đúng số lần, hiện đúng dạng sau khi che.
    // Thêm 1 pháp nhân (2 cách viết) và 1 người đại diện -> chạy -> file tải về đúng; residual PASS.
    it('B1: detects 2 emails, 3 phones, 1 CCCD, 1 MST, 1 STK, 1 address; adds entities; anonymizes and verifies PASS', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      const logFn = vi.fn()

      const mockDocxBytes = await createMockDocx({
        documentText: fixtureText,
        comments: [
          {
            id: 1,
            author: 'Học viên Test 01',
            initials: 'HV01',
            text: 'Bình luận hợp lệ.',
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
      const file = new File([mockDocxBytes], 'fake-contract.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      await uploadMockFile(fileInput, file)

      // 1. Verify detected sensitive card
      expect(container.textContent).toContain('Thông tin nhạy cảm phát hiện được')
      expect(container.textContent).toContain('Email (2)')
      expect(container.textContent).toContain('Số điện thoại (3)')
      expect(container.textContent).toContain('CCCD/CMND (1)')
      expect(container.textContent).toContain('Mã số thuế (1)')
      expect(container.textContent).toContain('Số tài khoản (1)')
      expect(container.textContent).toContain('Địa chỉ (1)')

      // Verify masked preview formats
      expect(container.textContent).toContain('t****@e****.com')
      expect(container.textContent).toContain('c****@e****.com')
      expect(container.textContent).toContain('09******78')
      expect(container.textContent).toContain('*********345')
      expect(container.textContent).toContain('*******567-001')
      expect(container.textContent).toContain('**********7890')
      expect(container.textContent).toContain('****, ****, ****, TP.HCM')

      // 2. Add Organization entity (2 spellings)
      const addOrgBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Thêm pháp nhân')
      )
      expect(addOrgBtn).toBeDefined()
      await act(async () => {
        addOrgBtn!.click()
        await new Promise((r) => setTimeout(r, 50))
      })

      const textareas = Array.from(container.querySelectorAll('textarea'))
      expect(textareas.length).toBe(1)
      await act(async () => {
        setTextareaValue(textareas[0], 'Công ty TNHH Mẫu Thử\nMau Thu Co., Ltd')
        await new Promise((r) => setTimeout(r, 50))
      })

      // 3. Add Representative entity
      const addRepBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Thêm người đại diện')
      )
      expect(addRepBtn).toBeDefined()
      await act(async () => {
        addRepBtn!.click()
        await new Promise((r) => setTimeout(r, 50))
      })

      const updatedTextareas = Array.from(container.querySelectorAll('textarea'))
      expect(updatedTextareas.length).toBe(2)
      await act(async () => {
        setTextareaValue(updatedTextareas[1], 'Người Đại Diện Test 01')
        await new Promise((r) => setTimeout(r, 50))
      })

      // 4. Click "Ẩn danh tài liệu"
      const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ẩn danh tài liệu')
      )
      expect(anonymizeBtn).toBeDefined()
      expect(anonymizeBtn?.disabled).toBe(false)

      await act(async () => {
        anonymizeBtn!.click()
        await new Promise((r) => setTimeout(r, 500))
      })

      // 5. Verify results summary line
      expect(container.textContent).toContain(
        'Đã thay 3 tên pháp nhân/người đại diện; che 2 email, 3 số điện thoại, 1 CCCD/CMND, 1 MST, 1 số tài khoản, 1 địa chỉ'
      )

      // 6. Verify residual report is PASS
      expect(container.textContent).toContain('ĐẠT BẢO MẬT (PASS)')

      root.unmount()
      container.remove()
    })

    // B2: Bỏ chọn 1 số điện thoại và tắt loại "Địa chỉ" -> chạy -> số đó và địa chỉ còn nguyên, phần còn lại bị che
    it('B2: unchecks 1 phone and turns off address toggle; verifies phone and address preserved', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      const mockDocxBytes = await createMockDocx({
        documentText: fixtureText,
        comments: [{ id: 1, author: 'HV01', initials: 'H', text: 'Clean.' }],
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
      await uploadMockFile(fileInput, new File([mockDocxBytes], 'b2.docx'))

      // 1. Turn off "Địa chỉ" category toggle
      const addressToggleLabel = Array.from(
        container.querySelectorAll('.sensitive-toggle-item')
      ).find((el) => el.textContent?.includes('Địa chỉ'))
      const addressCb = addressToggleLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement
      expect(addressCb).toBeDefined()
      await act(async () => {
        addressCb.click()
        await new Promise((r) => setTimeout(r, 50))
      })

      // 2. Find phone table checkboxes ("Che") and uncheck the first phone (0912345678)
      const phoneGroup = Array.from(
        container.querySelectorAll('.sensitive-kind-group')
      ).find((g) => g.textContent?.includes('Số điện thoại'))
      const phoneRows = phoneGroup?.querySelectorAll('tbody tr')
      expect(phoneRows?.length).toBe(3)
      const firstPhoneKeepCb = phoneRows![0].querySelector('input[type="checkbox"]') as HTMLInputElement
      await act(async () => {
        firstPhoneKeepCb.click()
        await new Promise((r) => setTimeout(r, 50))
      })

      // 3. Click Anonymize
      const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ẩn danh tài liệu')
      )
      await act(async () => {
        anonymizeBtn!.click()
        await new Promise((r) => setTimeout(r, 500))
      })

      // 4. Verify summary: 0 address masked, 2 phones masked
      expect(container.textContent).toContain(
        'Đã thay 0 tên pháp nhân/người đại diện; che 2 email, 2 số điện thoại, 1 CCCD/CMND, 1 MST, 1 số tài khoản, 0 địa chỉ'
      )

      root.unmount()
      container.remove()
    })

    // B3: Fixture có chữ đã xoá chứa email -> mặc định ('mask') hiện thông báo "sẽ được che/thay thế", residual PASS, nút tải mở;
    // chọn radio "Giữ nguyên (chỉ cảnh báo)" -> hiện cảnh báo có chữ "KHÔNG", findings liệt kê 'deleted-text', nút tải mở
    it('B3: deleted text with email shows warning banner; anonymize gives WARN; download not locked', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      const mockDocxBytes = await createMockDocx({
        comments: [{ id: 1, author: 'HV01', initials: 'H', text: 'Clean.' }],
        revisions: [
          {
            type: 'del',
            author: 'HV01',
            part: 'document',
            text: 'email-in-del@example.com',
            isDelText: true,
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
      await uploadMockFile(fileInput, new File([mockDocxBytes], 'b3.docx'))

      // Wait for deletedHits inspection
      await act(async () => {
        await new Promise((r) => setTimeout(r, 150))
      })

      // Default ('mask') mode: shows warning banner and message "sẽ được che/thay thế"
      expect(container.textContent).toContain('Cảnh báo: Phát hiện thông tin trong phần chữ đã xoá (Track Changes)')
      expect(container.textContent).toContain('sẽ được che/thay thế')

      // Click anonymize
      const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ẩn danh tài liệu')
      )
      await act(async () => {
        anonymizeBtn!.click()
        await new Promise((r) => setTimeout(r, 500))
      })

      // In default 'mask' mode: residual PASS, download link active
      expect(container.textContent).toContain('ĐẠT BẢO MẬT (PASS)')
      let downloadLink = container.querySelector('a.primary')
      expect(downloadLink).not.toBeNull()
      expect(downloadLink?.getAttribute('download')).toBe('document_anonymized.docx')

      // Select radio "Giữ nguyên (chỉ cảnh báo)"
      const keepRadio = container.querySelector('input[type="radio"][value="keep"]') as HTMLInputElement
      expect(keepRadio).not.toBeNull()
      await act(async () => {
        keepRadio.click()
        keepRadio.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 100))
      })

      // Warning contains "KHÔNG"
      expect(container.textContent).toContain('KHÔNG')

      // Re-run anonymize in 'keep' mode
      const reAnonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ẩn danh tài liệu')
      )
      await act(async () => {
        reAnonymizeBtn!.click()
        await new Promise((r) => setTimeout(r, 500))
      })

      // Findings list 'deleted-text', download link still open
      expect(container.textContent).toContain('deleted-text')
      downloadLink = container.querySelector('a.primary')
      expect(downloadLink).not.toBeNull()
      expect(downloadLink?.getAttribute('download')).toBe('document_anonymized.docx')

      root.unmount()
      container.remove()
    })

    // B4: Nhãn trùng Người góp ý 1 -> hiện lỗi, nút chạy bị khoá. Sửa entity sau khi đã chạy -> kết quả cũ bị xoá, hiện dòng nhắc chạy lại
    it('B4: duplicate label with contributor shows error and locks run button; editing entity clears stale result', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      const mockDocxBytes = await createMockDocx({
        comments: [{ id: 1, author: 'Học viên Test 01', initials: 'HV01', text: 'Comment.' }],
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
      await uploadMockFile(fileInput, new File([mockDocxBytes], 'b4.docx'))

      // Contributor label defaults to "Người góp ý 1"
      const contributorInput = container.querySelector('table.word-table input[type="text"]') as HTMLInputElement
      expect(contributorInput.value).toBe('Người góp ý 1')

      // Add organization entity
      const addOrgBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Thêm pháp nhân')
      )
      await act(async () => {
        addOrgBtn!.click()
        await new Promise((r) => setTimeout(r, 50))
      })

      // Set entity label duplicate of contributor: "Người góp ý 1"
      const labelInput = container.querySelector('.entity-label-col input') as HTMLInputElement
      expect(labelInput).not.toBeNull()
      await act(async () => {
        setInputValue(labelInput, 'Người góp ý 1')
        await new Promise((r) => setTimeout(r, 50))
      })

      // Verify error message displayed and anonymize button disabled
      expect(container.textContent).toContain('trùng với nhãn người tham gia')
      const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ẩn danh tài liệu')
      )
      expect(anonymizeBtn?.disabled).toBe(true)

      // Fix label
      await act(async () => {
        setInputValue(labelInput, 'Pháp nhân A')
        await new Promise((r) => setTimeout(r, 50))
      })

      // Button is now enabled
      expect(anonymizeBtn?.disabled).toBe(false)

      // Run anonymization
      await act(async () => {
        anonymizeBtn!.click()
        await new Promise((r) => setTimeout(r, 400))
      })
      expect(container.querySelector('.residual-card')).not.toBeNull()

      // Edit entity textarea after run -> stale result cleared, reminder displayed
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement
      await act(async () => {
        setTextareaValue(textarea, 'Công ty TNHH Mới')
        await new Promise((r) => setTimeout(r, 50))
      })

      expect(container.querySelector('.residual-card')).toBeNull()
      expect(container.textContent).toContain('Cấu hình đã thay đổi — bấm "Ẩn danh tài liệu" để tạo lại file.')

      root.unmount()
      container.remove()
    })

    // B5: Log word_anonymizer.completed chỉ có số đếm, không chứa chuỗi tên/email/số nào từ fixture. localStorage/sessionStorage không dùng.
    it('B5: activity log completed only has counts, no raw strings; no localStorage/sessionStorage usage', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      const logFn = vi.fn()

      const mockDocxBytes = await createMockDocx({
        documentText: fixtureText,
        comments: [{ id: 1, author: 'HV01', initials: 'H', text: 'Clean.' }],
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
      await uploadMockFile(fileInput, new File([mockDocxBytes], 'b5.docx'))

      // Add entity
      const addOrgBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Thêm pháp nhân')
      )
      await act(async () => {
        addOrgBtn!.click()
        await new Promise((r) => setTimeout(r, 50))
      })

      const textarea = container.querySelector('textarea') as HTMLTextAreaElement
      await act(async () => {
        setTextareaValue(textarea, 'Công ty TNHH Mẫu Thử')
        await new Promise((r) => setTimeout(r, 50))
      })

      const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ẩn danh tài liệu')
      )
      await act(async () => {
        anonymizeBtn!.click()
        await new Promise((r) => setTimeout(r, 500))
      })

      // Verify log call
      expect(logFn).toHaveBeenCalledWith(
        'word_anonymizer.completed',
        'Ẩn danh tài liệu Word hoàn tất',
        expect.objectContaining({
          authorCount: expect.any(Number),
          commentCount: expect.any(Number),
          revisionCount: expect.any(Number),
          residualStatus: expect.any(String),
          entityReplacements: expect.any(Number),
          emailMasked: expect.any(Number),
          phoneMasked: expect.any(Number),
          nationalIdMasked: expect.any(Number),
          taxCodeMasked: expect.any(Number),
          bankAccountMasked: expect.any(Number),
          addressMasked: expect.any(Number),
        }),
        'success'
      )

      // Ensure no raw names or sensitive values appear in metadata
      const call = logFn.mock.calls.find((c) => c[0] === 'word_anonymizer.completed')
      expect(call).toBeDefined()
      const metadata = JSON.stringify(call?.[2] || {})
      expect(metadata).not.toContain('Công ty TNHH Mẫu Thử')
      expect(metadata).not.toContain('test1@example.com')
      expect(metadata).not.toContain('0912345678')
      expect(metadata).not.toContain('001099012345')

      // Ensure localStorage and sessionStorage do not have entity/sensitive data
      expect(localStorage.getItem('entities')).toBeNull()
      expect(sessionStorage.getItem('entities')).toBeNull()

      root.unmount()
      container.remove()
    })

    // B6: 390/768/1280px: 2 thẻ mới không tràn khung, trang không cuộn ngang.
    it('B6: at 390px, 768px, 1280px, cards do not overflow', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      const mockDocxBytes = await createMockDocx({
        documentText: fixtureText,
        comments: [{ id: 1, author: 'HV01', initials: 'H', text: 'Clean.' }],
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
      await uploadMockFile(fileInput, new File([mockDocxBytes], 'b6.docx'))

      for (const width of [390, 768, 1280]) {
        container.style.width = `${width}px`
        const cards = Array.from(container.querySelectorAll('.word-card'))
        expect(cards.length).toBeGreaterThanOrEqual(3)
        for (const card of cards) {
          expect(card.classList.contains('word-card')).toBe(true)
        }
      }

      root.unmount()
      container.remove()
    })

    // F-10 K1: Residual respects user keep/disable options
    it('K1-a: unchecking individual phone keeps phone, masks email, residual PASS', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      const fixtureText = 'Điện thoại: 0912 345 678; Email: lienhe.test@example.com'
      const mockDocxBytes = await createMockDocx({
        documentText: fixtureText,
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
      await uploadMockFile(fileInput, new File([mockDocxBytes], 'k1-a.docx'))

      // Uncheck "Che" for phone 0912 345 678
      const phoneGroup = Array.from(
        container.querySelectorAll('.sensitive-kind-group')
      ).find((g) => g.textContent?.includes('Số điện thoại'))
      const phoneRows = phoneGroup?.querySelectorAll('tbody tr')
      expect(phoneRows?.length).toBe(1)
      const phoneKeepCb = phoneRows![0].querySelector('input[type="checkbox"]') as HTMLInputElement
      await act(async () => {
        phoneKeepCb.click()
        await new Promise((r) => setTimeout(r, 50))
      })

      // Click Anonymize
      const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ẩn danh tài liệu')
      )
      await act(async () => {
        anonymizeBtn!.click()
        await new Promise((r) => setTimeout(r, 500))
      })

      // Verify residual report is PASS (not WARN)
      expect(container.textContent).toContain('ĐẠT BẢO MẬT (PASS)')
      expect(container.textContent).not.toContain('CẢNH BÁO (WARN)')

      // Verify download link is ready
      const downloadLink = container.querySelector('a.primary') as HTMLAnchorElement
      expect(downloadLink).not.toBeNull()

      root.unmount()
      container.remove()
    })

    it('K1-b: disabling phone kind toggle keeps phone, masks email, residual PASS', async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)

      const fixtureText = 'Điện thoại: 0912 345 678; Email: lienhe.test@example.com'
      const mockDocxBytes = await createMockDocx({
        documentText: fixtureText,
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
      await uploadMockFile(fileInput, new File([mockDocxBytes], 'k1-b.docx'))

      // Turn off "Số điện thoại" toggle
      const phoneToggleLabel = Array.from(
        container.querySelectorAll('.sensitive-toggle-item')
      ).find((el) => el.textContent?.includes('Số điện thoại'))
      const phoneCb = phoneToggleLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement
      expect(phoneCb).toBeDefined()
      await act(async () => {
        phoneCb.click()
        await new Promise((r) => setTimeout(r, 50))
      })

      // Click Anonymize
      const anonymizeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Ẩn danh tài liệu')
      )
      await act(async () => {
        anonymizeBtn!.click()
        await new Promise((r) => setTimeout(r, 500))
      })

      // Verify residual report is PASS (not WARN)
      expect(container.textContent).toContain('ĐẠT BẢO MẬT (PASS)')
      expect(container.textContent).not.toContain('CẢNH BÁO (WARN)')

      root.unmount()
      container.remove()
    })
  })
})
