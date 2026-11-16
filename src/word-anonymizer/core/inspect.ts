import type JSZip from 'jszip'
import { OOXML_NAMESPACES } from './constants'
import { normalizeString } from './normalize'
import { IdentityKind, InspectionReport, KnownIdentity } from './types'
import { parseXml } from './xml'
import { loadSafeDocx } from './zip'

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export async function inspectDocx(input: ArrayBuffer): Promise<InspectionReport> {
  const zip = await loadSafeDocx(input)
  return inspectLoadedDocx(zip)
}

export async function inspectLoadedDocx(zip: JSZip): Promise<InspectionReport> {
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
        hl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
        hl.getAttribute('r:id') ||
        hl.getAttribute('id')

      if (!rId) continue
      const target = commentsRelsMap.get(rId)
      if (target && target.startsWith('mailto:')) {
        const email = target.slice('mailto:'.length).trim().toLowerCase()
        const textNodes = hl.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')
        let displayText = ''
        for (let t = 0; t < textNodes.length; t++) {
          displayText += textNodes[t].textContent || ''
        }
        displayText = displayText.replace(/^@/, '').trim()

        // Match with known identities by email or display text
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
          // Create new mentioned identity
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

  // 5. Collect warnings
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
  }
}
