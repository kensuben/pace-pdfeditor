import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  anonymizeDocx,
  buildDefaultMapping,
  inspectDocx,
  scanResidual,
  validateMapping,
} from '../core'
import { OOXML_NAMESPACES } from '../core/constants'
import { AnonymizerError } from '../core/types'
import { parseXml } from '../core/xml'
import { createMockDocx } from './fixtures'

describe('Word Anonymizer Core (W-1)', () => {
  // K1: 2 tác giả, 3 comment → Người góp ý 1/2, NG1/NG2; mọi w:t giữ nguyên
  it('K1: 2 authors, 3 comments -> anonymized authors/initials, w:t preserved', async () => {
    const input = await createMockDocx({
      comments: [
        { id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'Bình luận 1' },
        { id: 2, author: 'Nguyễn Văn A', initials: 'NVA', text: 'Bình luận 2' },
        { id: 3, author: 'Trần Thị B', initials: 'TTB', text: 'Bình luận 3' },
      ],
    })

    const report = await inspectDocx(input)
    expect(report.identities.length).toBe(2)
    expect(report.identities[0].author).toBe('Nguyễn Văn A')
    expect(report.identities[1].author).toBe('Trần Thị B')

    const mapping = buildDefaultMapping(report)
    expect(mapping['Nguyễn Văn A']).toEqual({ label: 'Người góp ý 1', initials: 'NG1' })
    expect(mapping['Trần Thị B']).toEqual({ label: 'Người góp ý 2', initials: 'NG2' })

    const valResult = validateMapping(mapping, report.identities)
    expect(valResult.valid).toBe(true)

    const result = await anonymizeDocx(input, mapping)
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const commentsXml = await outZip.file('word/comments.xml')!.async('string')
    const doc = parseXml(commentsXml)
    const commentEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'comment')

    expect(commentEls[0].getAttributeNS(OOXML_NAMESPACES.w, 'author')).toBe('Người góp ý 1')
    expect(commentEls[0].getAttributeNS(OOXML_NAMESPACES.w, 'initials')).toBe('NG1')

    expect(commentEls[1].getAttributeNS(OOXML_NAMESPACES.w, 'author')).toBe('Người góp ý 1')
    expect(commentEls[1].getAttributeNS(OOXML_NAMESPACES.w, 'initials')).toBe('NG1')

    expect(commentEls[2].getAttributeNS(OOXML_NAMESPACES.w, 'author')).toBe('Người góp ý 2')
    expect(commentEls[2].getAttributeNS(OOXML_NAMESPACES.w, 'initials')).toBe('NG2')

    // Verify all w:t text are preserved
    const textEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')
    const texts = Array.from(textEls).map((el) => el.textContent)
    expect(texts).toContain('Bình luận 1')
    expect(texts).toContain('Bình luận 2')
    expect(texts).toContain('Bình luận 3')
  })

  // K2: Comment trả lời (paraIdParent) → commentsExtended.xml giữ nguyên byte
  it('K2: commentsExtended.xml byte-identical preserved', async () => {
    const input = await createMockDocx({
      comments: [{ id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'Thread root' }],
      commentsExtended: [
        { paraId: '11111111' },
        { paraId: '22222222', paraIdParent: '11111111' },
      ],
    })

    const inZip = await JSZip.loadAsync(input)
    const originalExtBytes = await inZip.file('word/commentsExtended.xml')!.async('uint8array')

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping, { removeDates: false })

    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const outExtBytes = await outZip.file('word/commentsExtended.xml')!.async('uint8array')

    expect(outExtBytes.length).toBe(originalExtBytes.length)
    expect(Array.from(outExtBytes)).toEqual(Array.from(originalExtBytes))
  })

  // K3: w:ins/w:del/w:rPrChange ở document + header + footnotes → w:author đã thay, cùng nhãn
  it('K3: revisions across document, header, footnotes anonymized with matching label', async () => {
    const input = await createMockDocx({
      comments: [{ id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'C1' }],
      revisions: [
        { type: 'ins', author: 'Nguyễn Văn A', part: 'document', text: 'Chèn text' },
        { type: 'del', author: 'Nguyễn Văn A', part: 'header', text: 'Xoá text' },
        { type: 'rPrChange', author: 'Lê Văn C', part: 'footnotes' },
      ],
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    expect(mapping['Nguyễn Văn A'].label).toBe('Người góp ý 1')
    expect(mapping['Lê Văn C'].label).toBe('Người góp ý 2')

    const result = await anonymizeDocx(input, mapping)
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const docXml = await outZip.file('word/document.xml')!.async('string')
    const docDoc = parseXml(docXml)
    const insEl = docDoc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'ins')[0]
    expect(insEl.getAttributeNS(OOXML_NAMESPACES.w, 'author')).toBe('Người góp ý 1')

    const headerXml = await outZip.file('word/header1.xml')!.async('string')
    const headerDoc = parseXml(headerXml)
    const delEl = headerDoc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'del')[0]
    expect(delEl.getAttributeNS(OOXML_NAMESPACES.w, 'author')).toBe('Người góp ý 1')

    const footnotesXml = await outZip.file('word/footnotes.xml')!.async('string')
    const fnDoc = parseXml(footnotesXml)
    const rPrEl = fnDoc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'rPrChange')[0]
    expect(rPrEl.getAttributeNS(OOXML_NAMESPACES.w, 'author')).toBe('Người góp ý 2')
  })

  // K4: Prefix namespace khác (ns0: thay w:) → vẫn xử lý đúng
  it('K4: custom namespace prefix (ns0: instead of w:) handled correctly', async () => {
    const input = await createMockDocx({
      customNamespaces: { wordPrefix: 'ns0' },
      comments: [{ id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'Hello' }],
    })

    const report = await inspectDocx(input)
    expect(report.identities.length).toBe(1)
    expect(report.identities[0].author).toBe('Nguyễn Văn A')

    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping)
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const commentsXml = await outZip.file('word/comments.xml')!.async('string')
    const doc = parseXml(commentsXml)
    const commentEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'comment')
    expect(commentEls[0].getAttributeNS(OOXML_NAMESPACES.w, 'author')).toBe('Người góp ý 1')
  })

  // K5: people.xml có presenceInfo chứa email → bị xoá; residual PASS
  it('K5: people.xml presenceInfo removed and residual PASS', async () => {
    const input = await createMockDocx({
      comments: [{ id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'Check' }],
      people: [
        {
          author: 'Nguyễn Văn A',
          userId: 'nguyen.vana@example.com',
          providerId: 'AzureAD',
        },
      ],
    })

    const report = await inspectDocx(input)
    expect(report.identities[0].email).toBe('nguyen.vana@example.com')

    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping)
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const peopleXml = await outZip.file('word/people.xml')!.async('string')
    expect(peopleXml).not.toContain('presenceInfo')
    expect(peopleXml).not.toContain('nguyen.vana@example.com')

    const resReport = await scanResidual(await result.blob.arrayBuffer(), report.identities)
    expect(resReport.status).toBe('PASS')
    expect(resReport.findings.length).toBe(0)
  })

  // K6: core.xml/app.xml đã làm sạch; custom.xml: giữ MSIP_Label_x_Enabled, xoá ReviewerEmail
  it('K6: core.xml/app.xml scrubbed, custom.xml keeps MSIP_Label and drops ReviewerEmail', async () => {
    const input = await createMockDocx({
      coreProps: {
        creator: 'Nguyễn Văn A',
        lastModifiedBy: 'Trần Thị B',
        lastPrinted: '2026-01-01T00:00:00Z',
      },
      appProps: {
        company: 'PACE Institute',
        manager: 'Director',
        template: 'CustomTemplate.dotm',
      },
      customProps: [
        { name: 'MSIP_Label_x_Enabled', value: 'true' },
        { name: 'ReviewerEmail', value: 'secret@example.com' },
      ],
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping, {
      scrubDocProps: true,
      customPropsPolicy: 'keep-sensitivity-labels',
    })

    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const coreXml = await outZip.file('docProps/core.xml')!.async('string')
    const coreDoc = parseXml(coreXml)
    expect(coreDoc.getElementsByTagNameNS(OOXML_NAMESPACES.dc, 'creator')[0].textContent).toBe('Anonymized')
    expect(coreDoc.getElementsByTagNameNS(OOXML_NAMESPACES.coreProps, 'lastModifiedBy')[0].textContent).toBe('Anonymized')
    expect(coreDoc.getElementsByTagNameNS(OOXML_NAMESPACES.coreProps, 'lastPrinted').length).toBe(0)

    const appXml = await outZip.file('docProps/app.xml')!.async('string')
    const appDoc = parseXml(appXml)
    expect(appDoc.getElementsByTagNameNS(OOXML_NAMESPACES.appProps, 'Company')[0].textContent).toBe('')
    expect(appDoc.getElementsByTagNameNS(OOXML_NAMESPACES.appProps, 'Manager')[0].textContent).toBe('')
    expect(appDoc.getElementsByTagNameNS(OOXML_NAMESPACES.appProps, 'Template')[0].textContent).toBe('Normal.dotm')

    const customXml = await outZip.file('docProps/custom.xml')!.async('string')
    expect(customXml).toContain('MSIP_Label_x_Enabled')
    expect(customXml).not.toContain('ReviewerEmail')
  })

  // K7: Mention: thay khi replaceMentions=true, giữ khi false
  it('K7: mention replaced when replaceMentions=true and kept when false', async () => {
    const makeDoc = () =>
      createMockDocx({
        comments: [
          {
            id: 1,
            author: 'Trần Thị B',
            initials: 'TTB',
            text: '@Nguyễn Văn A vui lòng xem',
          },
        ],
        mentions: [{ relId: 'rId100', email: 'nguyen.vana@example.com' }],
      })

    const input1 = await makeDoc()
    const report1 = await inspectDocx(input1)
    expect(report1.identities.length).toBe(1)
    const mapping1: Record<string, { label: string; initials: string }> = {
      'Trần Thị B': { label: 'Người góp ý 1', initials: 'NG1' },
      'Nguyễn Văn A': { label: 'Người góp ý 2', initials: 'NG2' },
    }

    // replaceMentions: true
    const res1 = await anonymizeDocx(input1, mapping1, { replaceMentions: true })
    const zip1 = await JSZip.loadAsync(await res1.blob.arrayBuffer())
    const cXml1 = await zip1.file('word/comments.xml')!.async('string')
    expect(cXml1).toContain('@Người góp ý 2')
    expect(cXml1).not.toContain('@Nguyễn Văn A')
    const rels1 = await zip1.file('word/_rels/comments.xml.rels')!.async('string')
    expect(rels1).toContain('mailto:nguoi-gop-y-2@anonymized.invalid')

    // replaceMentions: false
    const input2 = await makeDoc()
    const res2 = await anonymizeDocx(input2, mapping1, { replaceMentions: false })
    const zip2 = await JSZip.loadAsync(await res2.blob.arrayBuffer())
    const cXml2 = await zip2.file('word/comments.xml')!.async('string')
    expect(cXml2).toContain('@Nguyễn Văn A')
    const rels2 = await zip2.file('word/_rels/comments.xml.rels')!.async('string')
    expect(rels2).toContain('mailto:nguyen.vana@example.com')
  })

  // K8: removeDates=true → không còn w:date
  it('K8: removeDates=true removes w:date attributes', async () => {
    const input = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Nguyễn Văn A',
          initials: 'NVA',
          date: '2026-05-01T10:00:00Z',
          text: 'Comment',
        },
      ],
      revisions: [
        {
          type: 'ins',
          author: 'Nguyễn Văn A',
          date: '2026-05-01T10:00:00Z',
          part: 'document',
        },
      ],
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping, { removeDates: true })
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const commentsXml = await outZip.file('word/comments.xml')!.async('string')
    const docXml = await outZip.file('word/document.xml')!.async('string')

    const cDoc = parseXml(commentsXml)
    expect(cDoc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'comment')[0].hasAttributeNS(OOXML_NAMESPACES.w, 'date')).toBe(false)

    const dDoc = parseXml(docXml)
    expect(dDoc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'ins')[0].hasAttributeNS(OOXML_NAMESPACES.w, 'date')).toBe(false)
  })

  // K9: Tên tác giả trong text comment, option tắt → text giữ nguyên, residual WARN, category comment-text
  it('K9: author name in comment text without option kept, residual WARN with category comment-text', async () => {
    const input = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Nguyễn Văn A',
          initials: 'NVA',
          text: 'Nhờ nguyễn văn a duyệt văn bản này',
        },
      ],
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping, {
      replaceNamesInCommentText: false,
      replaceMentions: false,
    })

    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const cXml = await outZip.file('word/comments.xml')!.async('string')
    expect(cXml).toContain('Nhờ nguyễn văn a duyệt văn bản này')

    const resReport = await scanResidual(await result.blob.arrayBuffer(), report.identities)
    expect(resReport.status).toBe('WARN')
    expect(resReport.findings.length).toBeGreaterThan(0)
    expect(resReport.findings[0].category).toBe('comment-text')
  })

  // K10: Mỗi mã lỗi ở mục 9 có 1 test; zip bomb không làm treo test (< 5 s)
  describe('K10: Input validation error codes', () => {
    it('throws TOO_LARGE for buffer > 50 MB', async () => {
      // Mock large buffer via proxy property to avoid 50MB memory allocation in test
      const largeBuffer = new ArrayBuffer(0)
      Object.defineProperty(largeBuffer, 'byteLength', { value: 51 * 1024 * 1024 })

      await expect(inspectDocx(largeBuffer)).rejects.toThrowError(AnonymizerError)
      await expect(inspectDocx(largeBuffer)).rejects.toMatchObject({ code: 'TOO_LARGE' })
    })

    it('throws ENCRYPTED_OR_LEGACY for magic D0 CF 11 E0', async () => {
      const buffer = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00]).buffer
      await expect(inspectDocx(buffer)).rejects.toMatchObject({ code: 'ENCRYPTED_OR_LEGACY' })
    })

    it('throws ZIP_BOMB for > 2000 entries fast (< 5s)', async () => {
      const zip = new JSZip()
      for (let i = 0; i <= 2001; i++) {
        zip.file(`file_${i}.txt`, 'x')
      }
      const buffer = await zip.generateAsync({ type: 'arraybuffer' })
      const start = Date.now()
      await expect(inspectDocx(buffer)).rejects.toMatchObject({ code: 'ZIP_BOMB' })
      expect(Date.now() - start).toBeLessThan(5000)
    })

    it('throws NOT_DOCX when missing required parts or having path traversal', async () => {
      const zip = new JSZip()
      zip.file('hello.txt', 'not docx')
      const buffer = await zip.generateAsync({ type: 'arraybuffer' })
      await expect(inspectDocx(buffer)).rejects.toMatchObject({ code: 'NOT_DOCX' })

      const zipTraversal = new JSZip()
      zipTraversal.file('[Content_Types].xml', '<Types/>')
      zipTraversal.file('word/document.xml', '<w:document/>')
      zipTraversal.file('../evil.txt', 'evil')
      const bufTraversal = await zipTraversal.generateAsync({ type: 'arraybuffer' })
      await expect(inspectDocx(bufTraversal)).rejects.toMatchObject({ code: 'NOT_DOCX' })
    })

    it('throws MACRO_ENABLED when containing vbaProject.bin', async () => {
      const zip = new JSZip()
      zip.file('[Content_Types].xml', '<Types/>')
      zip.file('word/document.xml', '<w:document/>')
      zip.file('word/vbaProject.bin', 'binary')
      const buffer = await zip.generateAsync({ type: 'arraybuffer' })
      await expect(inspectDocx(buffer)).rejects.toMatchObject({ code: 'MACRO_ENABLED' })
    })

    it('throws INVALID_XML when containing DOCTYPE or malformed XML', async () => {
      const zip = new JSZip()
      zip.file('[Content_Types].xml', '<Types/>')
      zip.file(
        'word/document.xml',
        '<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><w:document/>'
      )
      const buffer = await zip.generateAsync({ type: 'arraybuffer' })
      await expect(inspectDocx(buffer)).rejects.toMatchObject({ code: 'INVALID_XML' })
    })
  })

  // K11: File không có comment/revision chạy được, report 0 tác giả. Idempotent on second run
  it('K11: file without comments/revisions runs with 0 authors, idempotent', async () => {
    const input = await createMockDocx()
    const report1 = await inspectDocx(input)
    expect(report1.identities.length).toBe(0)
    expect(report1.stats.authorCount).toBe(0)
    expect(report1.stats.commentCount).toBe(0)

    const mapping = buildDefaultMapping(report1)
    const result1 = await anonymizeDocx(input, mapping)
    const buf1 = await result1.blob.arrayBuffer()

    const report2 = await inspectDocx(buf1)
    expect(report2.identities.length).toBe(0)

    const result2 = await anonymizeDocx(buf1, buildDefaultMapping(report2))
    const resReport = await scanResidual(await result2.blob.arrayBuffer(), [])
    expect(resReport.status).toBe('PASS')
  })

  // K12: Part không liên quan giữ nguyên byte; output qua được JSZip.loadAsync lại
  it('K12: unrelated binary part byte-identical and output loadable by JSZip', async () => {
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5])
    const input = await createMockDocx({
      comments: [{ id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'C' }],
      unrelatedPart: {
        path: 'word/media/image1.png',
        content: imageBytes,
      },
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping)

    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())
    expect(outZip.file('word/media/image1.png')).not.toBeNull()
    const outImgBytes = await outZip.file('word/media/image1.png')!.async('uint8array')

    expect(outImgBytes.length).toBe(imageBytes.length)
    expect(Array.from(outImgBytes)).toEqual(Array.from(imageBytes))
  })
})
