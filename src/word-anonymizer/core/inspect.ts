import type JSZip from 'jszip'
import { OOXML_NAMESPACES } from './constants'
import { normalizeString } from './normalize'
import { findSensitive, normalizePhone } from './sensitive'
import { suggestFromLabels } from './entitySuggest'
import { findEntityMatches, findKeywordMatches } from './textReplace'
import {
  CustomEntity,
  DeletedTextHit,
  DeletedTextMode,
  IdentityKind,
  InspectionReport,
  KeywordMatchCounts,
  KeywordRule,
  KnownIdentity,
  SensitiveItem,
  SensitiveKind,
  SuggestParagraph,
} from './types'
import { parseXml } from './xml'
import { loadSafeDocx } from './zip'

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export async function inspectDocx(
  input: ArrayBuffer,
  entities: CustomEntity[] = []
): Promise<InspectionReport> {
  const zip = await loadSafeDocx(input)
  return inspectLoadedDocx(zip, entities)
}

export async function inspectDeletedText(
  input: ArrayBuffer | JSZip,
  entities: CustomEntity[] = []
): Promise<DeletedTextHit[]> {
  const isZip = typeof (input as JSZip).file === 'function'
  const zip = isZip ? (input as JSZip) : await loadSafeDocx(input as ArrayBuffer)
  return scanDeletedText(zip, entities)
}

function getDirectParagraphTNodes(p: Element): Element[] {
  const allT = Array.from(p.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
  return allT.filter((tNode) => {
    let curr = tNode.parentElement
    while (curr && curr !== p) {
      if (curr.localName === 'p' && curr.namespaceURI === OOXML_NAMESPACES.w) {
        return false
      }
      curr = curr.parentElement
    }
    return true
  })
}

async function scanDeletedText(
  zip: JSZip,
  entities: CustomEntity[] = []
): Promise<DeletedTextHit[]> {
  const hits: DeletedTextHit[] = []

  const entries = Object.keys(zip.files).sort()
  for (const path of entries) {
    if (!path.startsWith('word/') || !path.endsWith('.xml')) continue
    const file = zip.file(path)
    if (!file) continue

    const xmlText = await file.async('string')
    if (!xmlText.includes('delText')) continue

    const doc = parseXml(xmlText)
    const delNodes = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
    if (delNodes.length === 0) continue

    const combinedDelText = delNodes.map((n) => n.textContent || '').join(' ')
    if (!combinedDelText.trim()) continue

    // Sensitive matches
    const sensitiveMatches = findSensitive(combinedDelText)
    for (const sm of sensitiveMatches) {
      hits.push({
        kind: sm.kind,
        type: 'sensitive',
        text: sm.value,
        count: 1,
        part: path,
      })
    }

    // Entity matches
    if (entities.length > 0) {
      const entityMatches = findEntityMatches(combinedDelText, entities)
      for (const em of entityMatches) {
        hits.push({
          kind: 'entity',
          type: 'entity',
          label: em.replacementText,
          text: combinedDelText.slice(em.start, em.end),
          count: 1,
          part: path,
        })
      }
    }
  }

  return hits
}

const CELL_LABEL_REGEX =
  /^\s*(?:(?:\d+|[a-zA-Z]|[ivxIVX]+)[.)–—:-]\s*)*(?:(?:bên|ben)\s+(?:[a-d]|mua|bán|ban|thuê|thue|cho\s+thuê|cho\s+thue|giao|nhận|nhan|cung\s+cấp|cung\s+cap|sử\s+dụng|su\s+dung)(?:\s*\([^)]*\))?|(?:người\s+đại\s+diện|nguoi\s+dai\s+dien|đại\s+diện\s+theo\s+pháp\s+luật|dai\s+dien\s+theo\s+phap\s+luat|đại\s+diện\s+bởi|dai\s+dien\s+boi|đại\s+diện|dai\s+dien)|(?:chức|chuc)\s+(?:vụ|vu)|(?:giấy|giay)\s+(?:ủy|uỷ|uy)\s+(?:quyền|quyen)(?:\s*(?:số|so))?|(?:hợp|hop)\s+(?:đồng|dong)(?:\s*(?:số|so))?|(?:số|so)\s+(?:hợp|hop)\s+(?:đồng|dong))\s*[:.-]?\s*$/i

function extractParagraphStreams(p: Element): {
  bodyText: string
  deletedText: string
  originalText: string
  originalCharSources: ('body' | 'deleted')[]
} {
  let bodyText = ''
  let deletedText = ''
  let originalText = ''
  const originalCharSources: ('body' | 'deleted')[] = []

  const walk = (node: Node, inDel: boolean, inIns: boolean) => {
    if (node !== p && node.nodeType === 1 /* Element */) {
      const el = node as Element
      if (el.localName === 'p' && el.namespaceURI === OOXML_NAMESPACES.w) {
        return
      }
      if (el.localName === 'del' && el.namespaceURI === OOXML_NAMESPACES.w) {
        for (let i = 0; i < el.childNodes.length; i++) {
          walk(el.childNodes[i], true, inIns)
        }
        return
      }
      if (el.localName === 'ins' && el.namespaceURI === OOXML_NAMESPACES.w) {
        for (let i = 0; i < el.childNodes.length; i++) {
          walk(el.childNodes[i], inDel, true)
        }
        return
      }
      if (el.localName === 'tab' && el.namespaceURI === OOXML_NAMESPACES.w) {
        if (inDel) {
          deletedText += '\t'
          originalText += '\t'
          originalCharSources.push('deleted')
        } else {
          bodyText += '\t'
          if (!inIns) {
            originalText += '\t'
            originalCharSources.push('body')
          }
        }
        return
      }
      if (el.localName === 't' && el.namespaceURI === OOXML_NAMESPACES.w && !inDel) {
        const textContent = el.textContent || ''
        bodyText += textContent
        if (!inIns) {
          originalText += textContent
          for (let i = 0; i < textContent.length; i++) {
            originalCharSources.push('body')
          }
        }
        return
      }
      if (el.localName === 'delText' && el.namespaceURI === OOXML_NAMESPACES.w && inDel) {
        const textContent = el.textContent || ''
        deletedText += textContent
        originalText += textContent
        for (let i = 0; i < textContent.length; i++) {
          originalCharSources.push('deleted')
        }
        return
      }
    }

    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i], inDel, inIns)
    }
  }

  walk(p, false, false)
  return { bodyText, deletedText, originalText, originalCharSources }
}

export async function inspectLoadedDocx(
  zip: JSZip,
  entities: CustomEntity[] = []
): Promise<InspectionReport> {
  const identitiesMap = new Map<string, KnownIdentity>()
  let commentCount = 0
  let revisionCount = 0
  const warnings: string[] = []

  const addIdentity = (
    authorRaw: string,
    source: string,
    kind: IdentityKind = 'contributor',
    extra?: { initials?: string; email?: string; userId?: string }
  ) => {
    const author = normalizeString(authorRaw)
    if (!author) return

    let existing = identitiesMap.get(author)
    if (!existing) {
      existing = {
        author,
        kind,
        sources: [],
      }
      identitiesMap.set(author, existing)
    }

    if (!existing.sources.includes(source)) {
      existing.sources.push(source)
    }
    // A contributor role takes precedence over mentioned
    if (kind === 'contributor' && existing.kind === 'mentioned') {
      existing.kind = 'contributor'
    }
    if (extra?.initials && !existing.initials) {
      existing.initials = normalizeString(extra.initials)
    }
    if (extra?.email && !existing.email) {
      existing.email = extra.email.trim().toLowerCase()
    }
    if (extra?.userId && !existing.userId) {
      existing.userId = extra.userId.trim()
    }
  }

  // Helper map: relId -> Target for comments.xml.rels
  const commentsRelsMap = new Map<string, string>()
  const referencedRelIds = new Set<string>()
  const commentsRelsFile = zip.file('word/_rels/comments.xml.rels')
  if (commentsRelsFile) {
    const xmlText = await commentsRelsFile.async('string')
    const doc = parseXml(xmlText)
    const relEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.rels, 'Relationship')
    for (let i = 0; i < relEls.length; i++) {
      const rel = relEls[i]
      const id = rel.getAttribute('Id')
      const target = rel.getAttribute('Target')
      if (id && target) {
        commentsRelsMap.set(id, target)
      }
    }
  }

  // 1. Scan word/comments.xml FIRST (priority order)
  const commentsFile = zip.file('word/comments.xml')
  if (commentsFile) {
    const xmlText = await commentsFile.async('string')
    const doc = parseXml(xmlText)

    // Comments author & initials
    const commentEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'comment')
    for (let i = 0; i < commentEls.length; i++) {
      const el = commentEls[i]
      commentCount++

      const authorAttr = el.getAttributeNodeNS(OOXML_NAMESPACES.w, 'author')
      const initialsAttr = el.getAttributeNodeNS(OOXML_NAMESPACES.w, 'initials')

      if (authorAttr?.value) {
        addIdentity(authorAttr.value, 'word/comments.xml', 'contributor', {
          initials: initialsAttr?.value,
        })
      }
    }

    // Revisions inside comments.xml (w:ins, w:del, w:rPrChange...)
    const allElsInComments = doc.getElementsByTagName('*')
    for (let i = 0; i < allElsInComments.length; i++) {
      const el = allElsInComments[i]
      if (el.localName === 'comment' && el.namespaceURI === OOXML_NAMESPACES.w) {
        continue // Skip the comment element itself, already counted
      }

      const attrs = el.attributes
      for (let j = 0; j < attrs.length; j++) {
        const attr = attrs[j]
        if (
          attr.localName === 'author' &&
          attr.namespaceURI === OOXML_NAMESPACES.w &&
          attr.value
        ) {
          revisionCount++
          addIdentity(attr.value, 'word/comments.xml', 'contributor')
        }
      }
    }

    // Scan for @mention hyperlinks in comments.xml
    const hyperlinkEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'hyperlink')
    for (let i = 0; i < hyperlinkEls.length; i++) {
      const hl = hyperlinkEls[i]
      const rId =
        hl.getAttributeNS(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'id'
        ) ||
        hl.getAttribute('r:id') ||
        hl.getAttribute('id')

      if (!rId) continue
      referencedRelIds.add(rId)
      const target = commentsRelsMap.get(rId)
      if (target && target.startsWith('mailto:')) {
        const email = target.slice('mailto:'.length).trim().toLowerCase()
        const textNodes = hl.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')
        let displayText = ''
        for (let t = 0; t < textNodes.length; t++) {
          displayText += textNodes[t].textContent || ''
        }
        displayText = displayText.replace(/^@/, '').trim()

        let matched = false
        for (const ident of identitiesMap.values()) {
          if (ident.email && ident.email.toLowerCase() === email) {
            matched = true
            break
          }
          if (displayText && normalizeString(ident.author) === normalizeString(displayText)) {
            ident.email = ident.email || email
            matched = true
            break
          }
        }

        if (!matched) {
          const authorName = displayText || email
          addIdentity(authorName, 'word/comments.xml', 'mentioned', { email })
        }
      }
    }
  }

  // 2. Scan all other XML parts under word/ for revisions
  const entries = Object.keys(zip.files).sort()
  for (const path of entries) {
    if (!path.startsWith('word/') || !path.endsWith('.xml')) continue
    if (path === 'word/comments.xml' || path === 'word/people.xml') continue

    const file = zip.file(path)
    if (!file) continue

    const xmlText = await file.async('string')
    const doc = parseXml(xmlText)
    const allEls = doc.getElementsByTagName('*')

    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i]
      const attrs = el.attributes
      for (let j = 0; j < attrs.length; j++) {
        const attr = attrs[j]
        if (
          attr.localName === 'author' &&
          attr.namespaceURI === OOXML_NAMESPACES.w &&
          attr.value
        ) {
          revisionCount++
          addIdentity(attr.value, path, 'contributor')
        }
      }
    }
  }

  // 3. Scan word/people.xml for author, email, userId
  const peopleFile = zip.file('word/people.xml')
  if (peopleFile) {
    const xmlText = await peopleFile.async('string')
    const doc = parseXml(xmlText)
    const personEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w15, 'person')

    for (let i = 0; i < personEls.length; i++) {
      const personEl = personEls[i]
      const author =
        personEl.getAttributeNS(OOXML_NAMESPACES.w15, 'author') ||
        personEl.getAttribute('author')

      let email: string | undefined
      let userId: string | undefined

      const presenceEls = personEl.getElementsByTagNameNS(
        OOXML_NAMESPACES.w15,
        'presenceInfo'
      )
      if (presenceEls.length > 0) {
        const presence = presenceEls[0]
        const rawUserId =
          presence.getAttributeNS(OOXML_NAMESPACES.w15, 'userId') ||
          presence.getAttribute('userId')
        const rawProviderId =
          presence.getAttributeNS(OOXML_NAMESPACES.w15, 'providerId') ||
          presence.getAttribute('providerId')

        if (rawUserId) {
          userId = rawUserId
          const emailMatch = rawUserId.match(EMAIL_REGEX)
          if (emailMatch) {
            email = emailMatch[0].toLowerCase()
          }
        }

        if (!email && rawProviderId) {
          const providerMatch = rawProviderId.match(EMAIL_REGEX)
          if (providerMatch) {
            email = providerMatch[0].toLowerCase()
          }
        }
      }

      if (author) {
        addIdentity(author, 'word/people.xml', 'contributor', { email, userId })
      }
    }
  }

  // 4. Scan docProps/core.xml for creator & lastModifiedBy
  const corePropsFile = zip.file('docProps/core.xml')
  if (corePropsFile) {
    const xmlText = await corePropsFile.async('string')
    const doc = parseXml(xmlText)
    const creatorEl = doc.getElementsByTagNameNS(OOXML_NAMESPACES.dc, 'creator')[0]
    const modifiedByEl = doc.getElementsByTagNameNS(
      OOXML_NAMESPACES.coreProps,
      'lastModifiedBy'
    )[0]

    if (creatorEl?.textContent) {
      addIdentity(creatorEl.textContent, 'docProps/core.xml', 'contributor')
    }
    if (modifiedByEl?.textContent) {
      addIdentity(modifiedByEl.textContent, 'docProps/core.xml', 'contributor')
    }
  }

  // 4b. Scan for orphan mailto: relationships in word/_rels/comments.xml.rels
  for (const [rId, target] of commentsRelsMap.entries()) {
    if (target && target.toLowerCase().startsWith('mailto:') && !referencedRelIds.has(rId)) {
      const email = target.slice('mailto:'.length).trim().toLowerCase()
      if (!email) continue

      let matched = false
      for (const ident of identitiesMap.values()) {
        if (
          (ident.email && ident.email.toLowerCase() === email) ||
          normalizeString(ident.author).toLowerCase() === email
        ) {
          ident.email = ident.email || email
          if (!ident.sources.includes('word/_rels/comments.xml.rels')) {
            ident.sources.push('word/_rels/comments.xml.rels')
          }
          matched = true
          break
        }
      }

      if (!matched) {
        addIdentity(email, 'word/_rels/comments.xml.rels', 'mentioned', { email })
      }
    }
  }

  // 4c. Scan for sensitive data in text parts and .rels
  const sensitiveMap = new Map<string, SensitiveItem>()

  const addSensitiveFinding = (kind: SensitiveKind, value: string, normalized: string) => {
    const key = `${kind}:${normalized}`
    const existing = sensitiveMap.get(key)
    if (existing) {
      existing.count++
    } else {
      sensitiveMap.set(key, {
        kind,
        value,
        normalized,
        count: 1,
      })
    }
  }

  const suggestParagraphs: SuggestParagraph[] = []

  for (const path of entries) {
    if (path.startsWith('word/') && path.endsWith('.xml') && path !== 'word/people.xml') {
      const file = zip.file(path)
      if (!file) continue
      const xmlText = await file.async('string')
      const doc = parseXml(xmlText)
      const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

      const isSuggestPart =
        path === 'word/document.xml' ||
        path.startsWith('word/header') ||
        path.startsWith('word/footer')

      for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
        const p = paragraphs[pIdx]
        if (isSuggestPart) {
          const { bodyText, originalText, originalCharSources } =
            extractParagraphStreams(p)
          if (originalText.trim()) {
            suggestParagraphs.push({
              text: originalText,
              source: originalCharSources.includes('deleted') ? 'deleted' : 'body',
              charSources: originalCharSources,
              paraId: `${path}#p_${pIdx}`,
              stream: 'original',
            })
          }
          if (bodyText !== originalText && bodyText.trim()) {
            suggestParagraphs.push({
              text: bodyText,
              source: 'body',
              paraId: `${path}#p_${pIdx}`,
              stream: 'body',
            })
          }
        }

        const tNodes = getDirectParagraphTNodes(p)
        if (tNodes.length === 0) continue
        const paraText = tNodes.map((n) => n.textContent || '').join('')
        if (!paraText.trim()) continue

        const matches = findSensitive(paraText)
        for (const m of matches) {
          addSensitiveFinding(m.kind, m.value, m.normalized)
        }
      }

      if (isSuggestPart) {
        const tables = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'tbl'))
        for (let tIdx = 0; tIdx < tables.length; tIdx++) {
          const tbl = tables[tIdx]
          const rows = Array.from(tbl.childNodes).filter(
            (n) =>
              n.nodeType === 1 &&
              (n as Element).localName === 'tr' &&
              (n as Element).namespaceURI === OOXML_NAMESPACES.w
          ) as Element[]

          for (let rIdx = 0; rIdx < rows.length; rIdx++) {
            const row = rows[rIdx]
            const cells = Array.from(row.childNodes).filter(
              (n) =>
                n.nodeType === 1 &&
                (n as Element).localName === 'tc' &&
                (n as Element).namespaceURI === OOXML_NAMESPACES.w
            ) as Element[]

            for (let cIdx = 0; cIdx < cells.length - 1; cIdx++) {
              const leftCell = cells[cIdx]
              const rightCell = cells[cIdx + 1]

              const leftParas = Array.from(leftCell.childNodes).filter(
                (n) =>
                  n.nodeType === 1 &&
                  (n as Element).localName === 'p' &&
                  (n as Element).namespaceURI === OOXML_NAMESPACES.w
              ) as Element[]

              const leftTexts: string[] = []
              for (const lp of leftParas) {
                const { originalText } = extractParagraphStreams(lp)
                if (originalText.trim()) leftTexts.push(originalText.trim())
              }
              const leftCombined = leftTexts.join(' ').trim()

              if (CELL_LABEL_REGEX.test(leftCombined)) {
                const rightParas = Array.from(rightCell.childNodes).filter(
                  (n) =>
                    n.nodeType === 1 &&
                    (n as Element).localName === 'p' &&
                    (n as Element).namespaceURI === OOXML_NAMESPACES.w
                ) as Element[]

                const rightTexts: string[] = []
                const rightSources: ('body' | 'deleted')[] = []
                for (let rpIdx = 0; rpIdx < rightParas.length; rpIdx++) {
                  const { originalText, originalCharSources } = extractParagraphStreams(
                    rightParas[rpIdx]
                  )
                  if (rpIdx > 0 && originalText.trim()) {
                    rightTexts.push(' ')
                    rightSources.push('body')
                  }
                  rightTexts.push(originalText)
                  rightSources.push(...originalCharSources)
                }

                const rightCombined = rightTexts.join('')
                if (rightCombined.trim()) {
                  const labelClean = leftCombined.replace(/[:.-]+$/, '').trim()
                  const prefix = `${labelClean}:\t`
                  const prefixSources: ('body' | 'deleted')[] = new Array(prefix.length).fill(
                    'body'
                  )
                  const fullText = prefix + rightCombined
                  const fullSources = prefixSources.concat(rightSources)

                  suggestParagraphs.push({
                    text: fullText,
                    source: fullSources.includes('deleted') ? 'deleted' : 'body',
                    charSources: fullSources,
                    paraId: `${path}#tbl_${tIdx}_tr_${rIdx}_tc_${cIdx}`,
                    stream: 'original',
                  })
                }
              }
            }
          }
        }
      }
    }

    if (path.endsWith('.rels')) {
      const file = zip.file(path)
      if (!file) continue
      const xmlText = await file.async('string')
      const doc = parseXml(xmlText)
      const relEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.rels, 'Relationship')

      for (let i = 0; i < relEls.length; i++) {
        const target = relEls[i].getAttribute('Target') || ''
        if (target.toLowerCase().startsWith('mailto:')) {
          const email = target.slice('mailto:'.length).trim()
          if (email && !email.toLowerCase().endsWith('@anonymized.invalid')) {
            addSensitiveFinding('email', email, email.toLowerCase())
          }
        } else if (target.toLowerCase().startsWith('tel:')) {
          const phone = target.slice('tel:'.length).trim()
          const normalized = normalizePhone(phone)
          if (normalized) {
            addSensitiveFinding('phone', phone, normalized)
          }
        }
      }
    }
  }

  // 4d. Scan deleted text
  const deletedTextHits = await scanDeletedText(zip, entities)
  if (deletedTextHits.length > 0) {
    warnings.push(
      'Tài liệu có chữ đã xoá trong Track Changes chứa thông tin cần che. Công cụ không xử lý phần này — hãy Accept/Reject All Changes trong Word trước khi upload.'
    )
  }

  // 5. Collect other warnings
  let hasEmbeddings = false
  for (const path of entries) {
    if (path.startsWith('word/embeddings/')) {
      hasEmbeddings = true
      warnings.push(`Phát hiện tệp đính kèm nhúng trong '${path}'. Cần kiểm tra thủ công.`)
    }
    if (path.startsWith('docProps/thumbnail')) {
      warnings.push(`Phát hiện ảnh thu nhỏ tài liệu trong '${path}'.`)
    }
    if (path.startsWith('customXml/')) {
      warnings.push(`Phát hiện thành phần dữ liệu tuỳ chỉnh trong '${path}'.`)
    }

    if (path.endsWith('.rels')) {
      const file = zip.file(path)
      if (file) {
        const text = await file.async('string')
        if (text.includes('Target="file:///')) {
          warnings.push(`Phát hiện liên kết ngoài tới hệ thống tệp trong '${path}'.`)
        }
      }
    }
  }

  // Check word/settings.xml for docVars or attachedTemplate with Users path
  const settingsFile = zip.file('word/settings.xml')
  if (settingsFile) {
    const text = await settingsFile.async('string')
    const doc = parseXml(text)
    const docVars = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'docVars')
    if (docVars.length > 0) {
      warnings.push("Phát hiện biến tài liệu ('docVars') trong 'word/settings.xml'.")
    }
    const attachedTemplate = doc.getElementsByTagNameNS(
      OOXML_NAMESPACES.w,
      'attachedTemplate'
    )[0]
    if (attachedTemplate) {
      const val = attachedTemplate.getAttributeNS(OOXML_NAMESPACES.w, 'val')
      if (val && (val.includes('Users/') || val.includes('Users\\'))) {
        warnings.push("Phát hiện đường dẫn người dùng trong 'attachedTemplate' của 'word/settings.xml'.")
      }
    }
  }

  // Check document.xml for AUTHOR/USERNAME/LASTSAVEDBY fields
  const docFile = zip.file('word/document.xml')
  if (docFile) {
    const text = await docFile.async('string')
    const doc = parseXml(text)
    const fldSimples = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'fldSimple')
    for (let i = 0; i < fldSimples.length; i++) {
      const instr = fldSimples[i].getAttributeNS(OOXML_NAMESPACES.w, 'instr') || ''
      if (/AUTHOR|USERNAME|LASTSAVEDBY/i.test(instr)) {
        warnings.push(`Phát hiện trường thông tin tác giả trong văn bản: '${instr.trim()}'.`)
      }
    }
    const instrTexts = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'instrText')
    for (let i = 0; i < instrTexts.length; i++) {
      const instr = instrTexts[i].textContent || ''
      if (/AUTHOR|USERNAME|LASTSAVEDBY/i.test(instr)) {
        warnings.push(`Phát hiện trường thông tin tác giả trong văn bản: '${instr.trim()}'.`)
      }
    }
  }

  const identities = Array.from(identitiesMap.values())
  const sensitive = Array.from(sensitiveMap.values())
  const suggestions = suggestFromLabels(suggestParagraphs)

  return {
    identities,
    stats: {
      commentCount,
      revisionCount,
      authorCount: identities.length,
    },
    warnings,
    hasMacro: false,
    hasEmbeddings,
    sensitive,
    deletedTextHits,
    suggestions,
  }
}

export async function countKeywordMatches(
  input: JSZip | ArrayBuffer,
  rules: KeywordRule[],
  deletedTextMode: DeletedTextMode = 'mask'
): Promise<KeywordMatchCounts> {
  const isZip = typeof (input as JSZip).file === 'function'
  const zip = isZip ? (input as JSZip) : await loadSafeDocx(input as ArrayBuffer)

  const counts: KeywordMatchCounts = {
    byRule: {},
    total: 0,
    byGroup: {
      body: 0,
      deleted: 0,
      comments: 0,
      headerFooter: 0,
      metadata: 0,
    },
  }

  for (const r of rules) {
    counts.byRule[r.id] = 0
  }

  if (rules.length === 0) {
    return counts
  }

  const entries = Object.keys(zip.files).sort()
  for (const path of entries) {
    if (path.startsWith('docProps/') && path.endsWith('.xml')) {
      const file = zip.file(path)
      if (!file) continue

      const xmlText = await file.async('string')
      if (!xmlText) continue

      try {
        const doc = parseXml(xmlText)
        const textNodes: Node[] = []
        const walk = (node: Node) => {
          if (node.nodeType === 3 /* Node.TEXT_NODE */) {
            textNodes.push(node)
          } else if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
            for (let i = 0; i < node.childNodes.length; i++) {
              walk(node.childNodes[i])
            }
          }
        }
        walk(doc.documentElement)

        for (const tNode of textNodes) {
          const text = (tNode.textContent || '').normalize('NFC')
          if (!text) continue

          const matches = findKeywordMatches(text, rules)
          for (const m of matches) {
            if (m.ruleId) {
              counts.byRule[m.ruleId] = (counts.byRule[m.ruleId] || 0) + 1
            }
            counts.byGroup.metadata++
            counts.total++
          }
        }
      } catch {
        // Ignore XML parse errors
      }
      continue
    }

    if (!path.startsWith('word/') || !path.endsWith('.xml') || path === 'word/people.xml') {
      continue
    }
    const file = zip.file(path)
    if (!file) continue

    const xmlText = await file.async('string')
    if (!xmlText) continue

    const doc = parseXml(xmlText)
    const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

    const isComment = path === 'word/comments.xml'
    const isHeaderFooter = path.startsWith('word/header') || path.startsWith('word/footer')
    const defaultGroup: 'comments' | 'headerFooter' | 'body' = isComment
      ? 'comments'
      : isHeaderFooter
      ? 'headerFooter'
      : 'body'

    for (const p of paragraphs) {
      // 1. Regular text stream (w:t)
      const tNodes = Array.from(p.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')).filter((tNode) => {
        let curr = tNode.parentElement
        while (curr && curr !== p) {
          if (curr.localName === 'p' && curr.namespaceURI === OOXML_NAMESPACES.w) return false
          curr = curr.parentElement
        }
        return true
      })
      if (tNodes.length > 0) {
        const streamText = tNodes.map((n) => n.textContent || '').join('')
        if (streamText) {
          const matches = findKeywordMatches(streamText, rules)
          for (const m of matches) {
            if (m.ruleId) {
              counts.byRule[m.ruleId] = (counts.byRule[m.ruleId] || 0) + 1
            }
            counts.byGroup[defaultGroup]++
            counts.total++
          }
        }
      }

      // 2. Track changes deleted text stream (w:delText)
      // Only count in deleted text if deletedTextMode is 'mask'
      if (deletedTextMode === 'mask') {
        const delNodes = Array.from(p.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText')).filter((delNode) => {
          let curr = delNode.parentElement
          while (curr && curr !== p) {
            if (curr.localName === 'p' && curr.namespaceURI === OOXML_NAMESPACES.w) return false
            curr = curr.parentElement
          }
          return true
        })
        if (delNodes.length > 0) {
          const streamText = delNodes.map((n) => n.textContent || '').join('')
          if (streamText) {
            const matches = findKeywordMatches(streamText, rules)
            for (const m of matches) {
              if (m.ruleId) {
                counts.byRule[m.ruleId] = (counts.byRule[m.ruleId] || 0) + 1
              }
              counts.byGroup.deleted++
              counts.total++
            }
          }
        }
      }
    }

    // Field codes
    const fldSimples = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'fldSimple'))
    for (const el of fldSimples) {
      const instr = el.getAttributeNS(OOXML_NAMESPACES.w, 'instr') || ''
      if (instr) {
        const matches = findKeywordMatches(instr, rules)
        for (const m of matches) {
          if (m.ruleId) counts.byRule[m.ruleId] = (counts.byRule[m.ruleId] || 0) + 1
          counts.byGroup[defaultGroup]++
          counts.total++
        }
      }
    }

    const instrTexts = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'instrText'))
    for (const el of instrTexts) {
      const instr = el.textContent || ''
      if (instr) {
        const matches = findKeywordMatches(instr, rules)
        for (const m of matches) {
          if (m.ruleId) counts.byRule[m.ruleId] = (counts.byRule[m.ruleId] || 0) + 1
          counts.byGroup[defaultGroup]++
          counts.total++
        }
      }
    }

    if (deletedTextMode === 'mask') {
      const delInstrTexts = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delInstrText'))
      for (const el of delInstrTexts) {
        const instr = el.textContent || ''
        if (instr) {
          const matches = findKeywordMatches(instr, rules)
          for (const m of matches) {
            if (m.ruleId) counts.byRule[m.ruleId] = (counts.byRule[m.ruleId] || 0) + 1
            counts.byGroup.deleted++
            counts.total++
          }
        }
      }
    }
  }

  return counts
}
