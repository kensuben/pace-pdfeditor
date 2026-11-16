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
    expect(report.identities[0].kind).toBe('contributor')
    expect(report.identities[1].author).toBe('Trần Thị B')
    expect(report.identities[1].kind).toBe('contributor')

    const mapping = buildDefaultMapping(report)
    expect(mapping['Nguyễn Văn A']).toEqual({
      label: 'Người góp ý 1',
      initials: 'NG1',
      alias: 'nguoi-gop-y-1',
    })
    expect(mapping['Trần Thị B']).toEqual({
      label: 'Người góp ý 2',
      initials: 'NG2',
      alias: 'nguoi-gop-y-2',
    })

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
    expect(report1.identities.length).toBe(2)
    expect(report1.identities[0].author).toBe('Trần Thị B')
    expect(report1.identities[1].author).toBe('nguyen.vana@example.com')
    expect(report1.identities[1].kind).toBe('mentioned')
    const mapping1: Record<string, { label: string; initials: string; alias: string }> = {
      'Trần Thị B': { label: 'Người góp ý 1', initials: 'NG1', alias: 'nguoi-gop-y-1' },
      'Nguyễn Văn A': { label: 'Người góp ý 2', initials: 'NG2', alias: 'nguoi-gop-y-2' },
      'nguyen.vana@example.com': { label: 'Người được nhắc 1', initials: 'NN1', alias: 'nguoi-gop-y-2' },
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

describe('QA Fixes (F-2)', () => {
  // K1: Fixture nén DEFLATE có word/document.xml khoảng 500 KB chữ lặp → output byteLength <= 1.5 x input
  it('F-2 K1: output size with DEFLATE is <= 1.5x input size for 500 KB repeated text', async () => {
    const largeText = 'Nội dung kiểm tra nén lặp lại của tài liệu Word. '.repeat(10500) // ~500 KB
    const input = await createMockDocx({
      documentText: largeText,
      comments: [{ id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'Bình luận' }],
      compression: 'DEFLATE',
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping)
    const outBuffer = await result.blob.arrayBuffer()

    expect(outBuffer.byteLength).toBeLessThanOrEqual(input.byteLength * 1.5)
  })

  // K2: Mention người chưa bình luận (@Giảng viên Test 09 + mailto:giangvien.test09@example.com)
  it('F-2 K2: mention of non-commenter creates mentioned identity, anonymizes text and rel, residual PASS; replaceMentions=false does not PASS', async () => {
    const makeDoc = () =>
      createMockDocx({
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
        mentions: [{ relId: 'rId99', email: 'giangvien.test09@example.com' }],
      })

    const input1 = await makeDoc()
    const report1 = await inspectDocx(input1)
    expect(report1.identities.length).toBe(2)
    const mentionedIdent = report1.identities.find((i) => i.kind === 'mentioned')
    expect(mentionedIdent).toBeDefined()
    expect(mentionedIdent!.author).toBe('Giảng viên Test 09')
    expect(mentionedIdent!.email).toBe('giangvien.test09@example.com')

    const mapping1 = buildDefaultMapping(report1)
    expect(mapping1['Giảng viên Test 09']).toEqual({
      label: 'Người được nhắc 1',
      initials: 'NN1',
      alias: 'nguoi-duoc-nhac-1',
    })

    // Case with replaceMentions: true
    const result1 = await anonymizeDocx(input1, mapping1, { replaceMentions: true })
    const outZip1 = await JSZip.loadAsync(await result1.blob.arrayBuffer())
    const cXml1 = await outZip1.file('word/comments.xml')!.async('string')
    expect(cXml1).not.toContain('Giảng viên Test 09')
    expect(cXml1).toContain('@Người được nhắc 1')

    const rels1 = await outZip1.file('word/_rels/comments.xml.rels')!.async('string')
    expect(rels1).toContain('mailto:nguoi-duoc-nhac-1@anonymized.invalid')

    const resReport1 = await scanResidual(await result1.blob.arrayBuffer(), report1.identities)
    expect(resReport1.status).toBe('PASS')

    // Case with replaceMentions: false
    const input2 = await makeDoc()
    const result2 = await anonymizeDocx(input2, mapping1, { replaceMentions: false })
    const resReport2 = await scanResidual(await result2.blob.arrayBuffer(), report1.identities)
    expect(resReport2.status).not.toBe('PASS')
  })

  // K3: <w:ins w:author="Học viên Test 01"> bên trong w:comment → đã thay nhãn; residual PASS; revisionCount tăng đúng 1
  it('F-2 K3: revision inside w:comment is anonymized, revisionCount increases, residual PASS', async () => {
    const input = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Người Tạo Comment',
          initials: 'NTC',
          text: 'Phần gốc',
          innerRevisions: [
            {
              type: 'ins',
              author: 'Học viên Test 01',
              text: 'Đoạn văn được sửa trong comment',
            },
          ],
        },
      ],
    })

    const report = await inspectDocx(input)
    expect(report.stats.revisionCount).toBe(1)
    expect(report.identities.some((i) => i.author === 'Học viên Test 01')).toBe(true)

    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping)
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const cXml = await outZip.file('word/comments.xml')!.async('string')
    expect(cXml).not.toContain('Học viên Test 01')
    expect(cXml).toContain(mapping['Học viên Test 01'].label)

    const resReport = await scanResidual(await result.blob.arrayBuffer(), report.identities)
    expect(resReport.status).toBe('PASS')
  })

  // K4: Comment của người thứ 2 mention chính người thứ 2 bằng email không giống tên
  it('F-2 K4: mention mapped by display text to contributor 2, foreign mention creates new mentioned identity', async () => {
    const input = await createMockDocx({
      comments: [
        { id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'Comment 1' },
        {
          id: 2,
          author: 'Trần Thị B',
          initials: 'TTB',
          text: '',
          hyperlink: {
            rId: 'rId20',
            text: '@Trần Thị B',
          },
        },
        {
          id: 3,
          author: 'Trần Thị B',
          initials: 'TTB',
          text: '',
          hyperlink: {
            rId: 'rId21',
            text: '@Người Lạ Khác',
          },
        },
      ],
      mentions: [
        { relId: 'rId20', email: 'vanthikhach@example.com' },
        { relId: 'rId21', email: 'nguoila@example.com' },
      ],
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)

    expect(mapping['Trần Thị B'].alias).toBe('nguoi-gop-y-2')
    expect(mapping['Người Lạ Khác'].alias).toBe('nguoi-duoc-nhac-1')

    const result = await anonymizeDocx(input, mapping, { replaceMentions: true })
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const relsXml = await outZip.file('word/_rels/comments.xml.rels')!.async('string')
    expect(relsXml).toContain('mailto:nguoi-gop-y-2@anonymized.invalid')
    expect(relsXml).toContain('mailto:nguoi-duoc-nhac-1@anonymized.invalid')
    expect(relsXml).not.toContain('mailto:nguoi-gop-y-1@anonymized.invalid')
  })

  // K5: removeDates=true trên fixture có w16du:dateUtc và một dateUtc thuộc namespace Word khác
  it('F-2 K5: removeDates=true removes w16du:dateUtc and any other dateUtc in Word namespace', async () => {
    const input = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Nguyễn Văn A',
          initials: 'NVA',
          date: '2026-01-01T00:00:00Z',
          dateUtc: {
            ns: 'http://schemas.microsoft.com/office/word/2023/wordml/du',
            name: 'dateUtc',
            value: '2026-01-01T00:00:00Z',
          },
          text: 'Comment with dates',
        },
      ],
      commentsExtended: [
        {
          paraId: '11111111',
          dateUtc: '2026-01-01T00:00:00Z',
        },
      ],
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping, { removeDates: true })
    const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())

    const cXml = await outZip.file('word/comments.xml')!.async('string')
    expect(cXml).not.toContain('dateUtc')
    expect(cXml).not.toContain('w:date')

    const extXml = await outZip.file('word/commentsExtended.xml')!.async('string')
    expect(extXml).not.toContain('dateUtc')
  })

  // K6: presenceInfo w15:userId="S::hocvien.test03@example.com::00000000-0000-0000-0000-000000000000"
  it('F-2 K6: presenceInfo S::<email>::<guid> extracts clean email, detects standalone email in comment text as WARN', async () => {
    const input = await createMockDocx({
      comments: [
        {
          id: 1,
          author: 'Học viên Test 03',
          initials: 'HV03',
          text: 'Vui lòng liên hệ hocvien.test03@example.com để biết thêm chi tiết',
        },
      ],
      people: [
        {
          author: 'Học viên Test 03',
          userId: 'S::hocvien.test03@example.com::00000000-0000-0000-0000-000000000000',
        },
      ],
    })

    const report = await inspectDocx(input)
    const ident = report.identities.find((i) => i.author === 'Học viên Test 03')
    expect(ident).toBeDefined()
    expect(ident!.email).toBe('hocvien.test03@example.com')
    expect(ident!.userId).toBe('S::hocvien.test03@example.com::00000000-0000-0000-0000-000000000000')

    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping)

    const resReport = await scanResidual(await result.blob.arrayBuffer(), report.identities)
    expect(resReport.status).toBe('WARN')
    const emailFinding = resReport.findings.find((f) => f.matchedString === 'hocvien.test03@example.com')
    expect(emailFinding).toBeDefined()
    expect(emailFinding!.category).toBe('comment-text')
  })

  // K7: Tên tác giả nằm trong w:delText ở document.xml → residual WARN, category body-text
  it('F-2 K7: author name in w:delText in document.xml classified as body-text (WARN, not FAIL)', async () => {
    const input = await createMockDocx({
      comments: [{ id: 1, author: 'Nguyễn Văn A', initials: 'NVA', text: 'Comment' }],
      revisions: [
        {
          type: 'del',
          author: 'Nguyễn Văn A',
          part: 'document',
          text: 'Đoạn văn xoá của Nguyễn Văn A',
          isDelText: true,
        },
      ],
    })

    const report = await inspectDocx(input)
    const mapping = buildDefaultMapping(report)
    const result = await anonymizeDocx(input, mapping)

    const resReport = await scanResidual(await result.blob.arrayBuffer(), report.identities)
    expect(resReport.status).toBe('WARN')
    const bodyFinding = resReport.findings.find((f) => f.category === 'body-text')
    expect(bodyFinding).toBeDefined()
  })

  // K8: Một entry giải nén 400 MB (toàn byte 0, nén DEFLATE) → ZIP_BOMB trong < 5 s, không hết bộ nhớ
  it('F-2 K8: 400 MB uncompressed entry triggers ZIP_BOMB in < 5s without memory exhaustion', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('word/document.xml', '<w:document/>')
    zip.file('huge.bin', 'compressed test data')

    const data = await zip.generateAsync({ type: 'uint8array' })
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    // Patch Central Directory uncompressedSize to 400 MB (419,430,400 bytes)
    for (let i = 0; i < data.length - 30; i++) {
      if (
        data[i] === 0x50 &&
        data[i + 1] === 0x4b &&
        data[i + 2] === 0x01 &&
        data[i + 3] === 0x02
      ) {
        const fnLen = view.getUint16(i + 28, true)
        const fn = Buffer.from(data.buffer, data.byteOffset + i + 46, fnLen).toString()
        if (fn === 'huge.bin') {
          // uncompressed size at offset 24
          view.setUint32(i + 24, 400 * 1024 * 1024, true)
        }
      }
    }

    const start = Date.now()
    await expect(inspectDocx(data.buffer as ArrayBuffer)).rejects.toMatchObject({ code: 'ZIP_BOMB' })
    expect(Date.now() - start).toBeLessThan(5000)
  })
})

describe('QA Fixes (F-4)', () => {
    // K1: comments.xml.rels có 2 rel mailto: mồ côi (vanthikhach@example.com, nguoila.test@example.com) → inspect có 2 danh tính mentioned; output không còn 2 email đó ở bất kỳ part nào; residual PASS. Cùng fixture với replaceMentions=false → residual không PASS.
    it('F-4 K1: orphan mailto rels inspected as mentioned identities, removed on replaceMentions=true (PASS), retained on false (FAIL)', async () => {
      const input = await createMockDocx({
        comments: [
          {
            id: 1,
            author: 'Học viên Test 01',
            initials: 'HV01',
            text: 'Nội dung bình luận mẫu',
          },
        ],
        mentions: [
          { relId: 'rIdOrphan1', email: 'vanthikhach@example.com' },
          { relId: 'rIdOrphan2', email: 'nguoila.test@example.com' },
        ],
      })

      const report = await inspectDocx(input)
      expect(report.identities.length).toBe(3)

      const orphan1 = report.identities.find((i) => i.author === 'vanthikhach@example.com')
      expect(orphan1).toBeDefined()
      expect(orphan1!.kind).toBe('mentioned')
      expect(orphan1!.email).toBe('vanthikhach@example.com')

      const orphan2 = report.identities.find((i) => i.author === 'nguoila.test@example.com')
      expect(orphan2).toBeDefined()
      expect(orphan2!.kind).toBe('mentioned')
      expect(orphan2!.email).toBe('nguoila.test@example.com')

      const mapping = buildDefaultMapping(report)

      // 1. replaceMentions: true -> output không còn 2 email, residual PASS
      const resTrue = await anonymizeDocx(input, mapping, { replaceMentions: true })
      const outTrueBuf = await resTrue.blob.arrayBuffer()
      const outTrueZip = await JSZip.loadAsync(outTrueBuf)

      for (const [path, file] of Object.entries(outTrueZip.files)) {
        if (!path.endsWith('.xml') && !path.endsWith('.rels')) continue
        const text = await file.async('string')
        expect(text).not.toContain('vanthikhach@example.com')
        expect(text).not.toContain('nguoila.test@example.com')
      }

      const residualTrue = await scanResidual(outTrueBuf, report.identities)
      expect(residualTrue.status).toBe('PASS')

      // 2. replaceMentions: false -> residual KHÔNG PASS
      const resFalse = await anonymizeDocx(input, mapping, { replaceMentions: false })
      const outFalseBuf = await resFalse.blob.arrayBuffer()
      const residualFalse = await scanResidual(outFalseBuf, report.identities)
      expect(residualFalse.status).not.toBe('PASS')
    })

    // K2: Rel mồ côi có email trùng email của một người góp ý (lấy từ people.xml) → Target = alias của người đó; không tạo danh tính mentioned mới.
    it('F-4 K2: orphan mailto matching people.xml contributor email uses contributor alias, no duplicate mentioned identity', async () => {
      const input = await createMockDocx({
        comments: [
          {
            id: 1,
            author: 'Giảng viên Test 02',
            initials: 'GV02',
            text: 'Bình luận của giảng viên',
          },
        ],
        people: [
          {
            author: 'Giảng viên Test 02',
            userId: 'giangvien.test02@example.com',
          },
        ],
        mentions: [
          {
            relId: 'rIdOrphanContributor',
            email: 'giangvien.test02@example.com',
          },
        ],
      })

      const report = await inspectDocx(input)
      expect(report.identities.length).toBe(1)
      expect(report.identities[0].author).toBe('Giảng viên Test 02')
      expect(report.identities[0].kind).toBe('contributor')
      expect(report.identities[0].email).toBe('giangvien.test02@example.com')

      const mapping = buildDefaultMapping(report)
      expect(mapping['Giảng viên Test 02'].alias).toBe('nguoi-gop-y-1')

      const result = await anonymizeDocx(input, mapping, { replaceMentions: true })
      const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())
      const relsXml = await outZip.file('word/_rels/comments.xml.rels')!.async('string')

      expect(relsXml).toContain('mailto:nguoi-gop-y-1@anonymized.invalid')
      expect(relsXml).not.toContain('giangvien.test02@example.com')
    })

    // K3: replaceNamesInCommentText=true; comment có <w:hyperlink r:id="rIdWeb"> trỏ https://example.com với text chứa tên Học viên Test 01 → tên đã được thay; mention mailto: trong cùng comment vẫn chỉ có đúng một @<nhãn> (không thay 2 lần).
    it('F-4 K3: replaceNamesInCommentText replaces name inside web hyperlink while mention mailto has exactly one @label', async () => {
      const input = await createMockDocx({
        comments: [
          {
            id: 1,
            author: 'Giảng viên Test 01',
            initials: 'GV01',
            rawContent: `<w:hyperlink r:id="rIdMention"><w:r><w:t>@Học viên Test 01</w:t></w:r></w:hyperlink><w:r><w:t> vui lòng xem bài nộp của </w:t></w:r><w:hyperlink r:id="rIdWeb"><w:r><w:t>Học viên Test 01 trang web</w:t></w:r></w:hyperlink>`,
          },
        ],
        mentions: [
          {
            relId: 'rIdMention',
            email: 'hocvien.test01@example.com',
          },
          {
            relId: 'rIdWeb',
            target: 'https://example.com/baitap',
          },
        ],
      })

      const report = await inspectDocx(input)
      expect(report.identities.some((i) => i.author === 'Giảng viên Test 01')).toBe(true)
      expect(report.identities.some((i) => i.author === 'Học viên Test 01')).toBe(true)

      const mapping = buildDefaultMapping(report)
      const hvMapped = mapping['Học viên Test 01']
      expect(hvMapped).toBeDefined()

      const result = await anonymizeDocx(input, mapping, {
        replaceMentions: true,
        replaceNamesInCommentText: true,
      })

      const outZip = await JSZip.loadAsync(await result.blob.arrayBuffer())
      const commentsXml = await outZip.file('word/comments.xml')!.async('string')

      // 1. Text inside web hyperlink must have name replaced
      expect(commentsXml).toContain(`${hvMapped.label} trang web`)
      expect(commentsXml).not.toContain('Học viên Test 01 trang web')

      // 2. Mention must have exactly one @<label>, not replaced twice
      expect(commentsXml).toContain(`@${hvMapped.label}`)
      const mentionOccurrences = (commentsXml.match(new RegExp(`@${hvMapped.label}`, 'g')) || []).length
      expect(mentionOccurrences).toBe(1)
      expect(commentsXml).not.toContain(`@@${hvMapped.label}`)
      expect(commentsXml).not.toContain(`@${hvMapped.label}${hvMapped.label}`)

      // 3. Web hyperlink relationship is preserved, mention rel is anonymized
      const relsXml = await outZip.file('word/_rels/comments.xml.rels')!.async('string')
      expect(relsXml).toContain('https://example.com/baitap')
      expect(relsXml).toContain(`mailto:${hvMapped.alias}@anonymized.invalid`)
      expect(relsXml).not.toContain('hocvien.test01@example.com')
    })
  })
