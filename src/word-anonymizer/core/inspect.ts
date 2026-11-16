import type JSZip from 'jszip'
import { OOXML_NAMESPACES } from './constants'
import { normalizeString } from './normalize'
import { InspectionReport, KnownIdentity } from './types'
import { parseXml } from './xml'
import { loadSafeDocx } from './zip'

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
    extra?: { initials?: string; email?: string; userId?: string }
  ) => {
    const author = normalizeString(authorRaw)
    if (!author) return

    let existing = identitiesMap.get(author)
    if (!existing) {
      existing = {
        author,
        sources: [],
      }
      identitiesMap.set(author, existing)
    }

    if (!existing.sources.includes(source)) {
      existing.sources.push(source)
    }
    if (extra?.initials && !existing.initials) {
      existing.initials = normalizeString(extra.initials)
    }
    if (extra?.email && !existing.email) {
      existing.email = extra.email.trim()
    }
    if (extra?.userId && !existing.userId) {
      existing.userId = extra.userId.trim()
    }
  }

  // 1. Scan word/comments.xml FIRST (priority order)
  const commentsFile = zip.file('word/comments.xml')
  if (commentsFile) {
    const xmlText = await commentsFile.async('string')
    const doc = parseXml(xmlText)
    const commentEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'comment')

    for (let i = 0; i < commentEls.length; i++) {
      const el = commentEls[i]
      commentCount++

      const authorAttr = el.getAttributeNodeNS(OOXML_NAMESPACES.w, 'author')
      const initialsAttr = el.getAttributeNodeNS(OOXML_NAMESPACES.w, 'initials')

      if (authorAttr?.value) {
        addIdentity(authorAttr.value, 'word/comments.xml', {
          initials: initialsAttr?.value,
        })
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
          addIdentity(attr.value, path)
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
        userId =
          presence.getAttributeNS(OOXML_NAMESPACES.w15, 'userId') ||
          presence.getAttribute('userId') ||
          undefined
        const providerId =
          presence.getAttributeNS(OOXML_NAMESPACES.w15, 'providerId') ||
          presence.getAttribute('providerId')

        if (userId && userId.includes('@')) {
          email = userId
        } else if (providerId && providerId.includes('@')) {
          email = providerId
        }
      }

      if (author) {
        addIdentity(author, 'word/people.xml', { email, userId })
      }
    }
  }

  // 4. Scan word/_rels/comments.xml.rels for mailto mentions
  const commentsRelsFile = zip.file('word/_rels/comments.xml.rels')
  if (commentsRelsFile) {
    const xmlText = await commentsRelsFile.async('string')
    const doc = parseXml(xmlText)
    const relEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.rels, 'Relationship')

    for (let i = 0; i < relEls.length; i++) {
      const rel = relEls[i]
      const target = rel.getAttribute('Target')
      if (target && target.startsWith('mailto:')) {
        const email = target.slice('mailto:'.length).trim()
        if (email) {
          // Check if any existing identity matches
          let matched = false
          for (const ident of identitiesMap.values()) {
            if (ident.email === email) {
              matched = true
              break
            }
          }
          if (!matched) {
            // Check if email local part matches an author
            for (const ident of identitiesMap.values()) {
              if (
                email.toLowerCase().includes(ident.author.toLowerCase()) ||
                ident.author.toLowerCase().includes(email.split('@')[0].toLowerCase())
              ) {
                ident.email = email
                break
              }
            }
          }
        }
      }
    }
  }

  // 5. Scan docProps/core.xml for creator & lastModifiedBy
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
      addIdentity(creatorEl.textContent, 'docProps/core.xml')
    }
    if (modifiedByEl?.textContent) {
      addIdentity(modifiedByEl.textContent, 'docProps/core.xml')
    }
  }

  // 6. Collect warnings
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
