import { OOXML_NAMESPACES } from './constants'
import { inspectLoadedDocx } from './inspect'
import { normalizeString } from './normalize'
import {
  AnonymizeOptions,
  AnonymizeResult,
  IdentityMapping,
  MappedIdentity,
} from './types'
import { parseXml, serializeXml } from './xml'
import { loadSafeDocx } from './zip'

const DEFAULT_OPTIONS: AnonymizeOptions = {
  removeDates: false,
  replaceMentions: true,
  replaceNamesInCommentText: false,
  scrubDocProps: true,
  customPropsPolicy: 'keep-sensitivity-labels',
}

function findNearestHyperlinkAncestor(node: Node): Element | null {
  let curr: Node | null = node.parentNode
  while (curr && curr.nodeType === 1 /* Node.ELEMENT_NODE */) {
    const el = curr as Element
    if (
      el.localName === 'hyperlink' &&
      (el.namespaceURI === OOXML_NAMESPACES.w || !el.namespaceURI)
    ) {
      return el
    }
    curr = curr.parentNode
  }
  return null
}

// TODO(verify): Cấu trúc mention w:hyperlink kết hợp mailto: - Word 365 dùng w:hyperlink trỏ rel mailto, cần kiểm tra thêm khi mention nằm trong comment phức tạp hoặc phân tách nhiều w:r/w:t.
export async function anonymizeDocx(
  input: ArrayBuffer,
  mapping: IdentityMapping,
  options?: Partial<AnonymizeOptions>
): Promise<AnonymizeResult> {
  const opts: AnonymizeOptions = { ...DEFAULT_OPTIONS, ...options }
  const zip = await loadSafeDocx(input)
  const inspection = await inspectLoadedDocx(zip)

  const modifiedParts: string[] = []
  const warnings: string[] = [...inspection.warnings]
  const processedMentionHyperlinks = new Set<Element>()

  const getMapped = (rawAuthor: string): MappedIdentity | undefined => {
    const key = normalizeString(rawAuthor)
    return mapping[key]
  }

  // Load comments rels map if present
  const commentsRelsFile = zip.file('word/_rels/comments.xml.rels')
  let commentsRelsDoc: Document | null = null
  let commentsRelsModified = false
  const relIdToElementMap = new Map<string, Element>()

  if (commentsRelsFile) {
    const relsText = await commentsRelsFile.async('string')
    commentsRelsDoc = parseXml(relsText)
    const relEls = commentsRelsDoc.getElementsByTagNameNS(
      OOXML_NAMESPACES.rels,
      'Relationship'
    )
    for (let i = 0; i < relEls.length; i++) {
      const rel = relEls[i]
      const id = rel.getAttribute('Id')
      if (id) {
        relIdToElementMap.set(id, rel)
      }
    }
  }

  // Helper to find mapped identity for a mention by email or display text
  const findMappedForMention = (
    email: string,
    displayText: string
  ): MappedIdentity | undefined => {
    // 1. Match by email in known identities
    for (const ident of inspection.identities) {
      if (ident.email && ident.email.toLowerCase() === email.toLowerCase()) {
        const mapped = getMapped(ident.author)
        if (mapped) return mapped
      }
    }

    // 2. Match by display text in mapping
    if (displayText) {
      const mapped = getMapped(displayText)
      if (mapped) return mapped
    }

    // 3. Match by email as mapping key directly
    return getMapped(email)
  }

  // 1. Process word/comments.xml
  const commentsFile = zip.file('word/comments.xml')
  if (commentsFile) {
    const xmlText = await commentsFile.async('string')
    const doc = parseXml(xmlText)
    let commentsModified = false

    // Process comment authors and initials
    const commentEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'comment')
    for (let i = 0; i < commentEls.length; i++) {
      const commentEl = commentEls[i]
      const authorAttr = commentEl.getAttributeNodeNS(OOXML_NAMESPACES.w, 'author')
      if (authorAttr?.value) {
        const mapped = getMapped(authorAttr.value)
        if (mapped) {
          authorAttr.value = mapped.label
          commentsModified = true

          const initialsAttr = commentEl.getAttributeNodeNS(
            OOXML_NAMESPACES.w,
            'initials'
          )
          if (initialsAttr) {
            initialsAttr.value = mapped.initials
          }
        }
      }

      if (opts.removeDates) {
        const dateAttr = commentEl.getAttributeNodeNS(OOXML_NAMESPACES.w, 'date')
        if (dateAttr) {
          commentEl.removeAttributeNode(dateAttr)
          commentsModified = true
        }

        const attrs = Array.from(commentEl.attributes)
        for (const attr of attrs) {
          if (
            attr.localName === 'dateUtc' &&
            (attr.namespaceURI?.startsWith('http://schemas.microsoft.com/office/word/') ||
              attr.namespaceURI === OOXML_NAMESPACES.w16du ||
              attr.namespaceURI === OOXML_NAMESPACES.w16cex)
          ) {
            commentEl.removeAttributeNode(attr)
            commentsModified = true
          }
        }
      }
    }

    // Process revisions INSIDE comments (w:ins, w:del, etc.)
    const allElsInComments = doc.getElementsByTagName('*')
    for (let i = 0; i < allElsInComments.length; i++) {
      const el = allElsInComments[i]
      if (el.localName === 'comment' && el.namespaceURI === OOXML_NAMESPACES.w) {
        continue
      }

      const attrs = Array.from(el.attributes)
      for (const attr of attrs) {
        if (
          attr.localName === 'author' &&
          attr.namespaceURI === OOXML_NAMESPACES.w &&
          attr.value
        ) {
          const mapped = getMapped(attr.value)
          if (mapped) {
            attr.value = mapped.label
            commentsModified = true
          }
        }

        if (opts.removeDates) {
          if (
            attr.localName === 'date' &&
            attr.namespaceURI === OOXML_NAMESPACES.w
          ) {
            el.removeAttributeNode(attr)
            commentsModified = true
          } else if (
            attr.localName === 'dateUtc' &&
            (attr.namespaceURI?.startsWith('http://schemas.microsoft.com/office/word/') ||
              attr.namespaceURI === OOXML_NAMESPACES.w16du ||
              attr.namespaceURI === OOXML_NAMESPACES.w16cex)
          ) {
            el.removeAttributeNode(attr)
            commentsModified = true
          }
        }
      }
    }

    // Process mentions via w:hyperlink
    if (opts.replaceMentions) {
      const hyperlinkEls = doc.getElementsByTagNameNS(
        OOXML_NAMESPACES.w,
        'hyperlink'
      )
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
        const relEl = relIdToElementMap.get(rId)
        if (!relEl) continue

        const target = relEl.getAttribute('Target') || ''
        if (target.toLowerCase().startsWith('mailto:')) {
          const email = target.slice('mailto:'.length).trim().toLowerCase()
          const textNodes = Array.from(
            hl.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')
          )
          let displayText = ''
          for (const tNode of textNodes) {
            displayText += tNode.textContent || ''
          }
          displayText = displayText.replace(/^@/, '').trim()

          const mapped = findMappedForMention(email, displayText)
          if (mapped) {
            // First w:t becomes @<label>, remaining w:t become empty
            if (textNodes.length > 0) {
              textNodes[0].textContent = `@${mapped.label}`
              for (let k = 1; k < textNodes.length; k++) {
                textNodes[k].textContent = ''
              }
              commentsModified = true
            }

            // Update Target in rels
            relEl.setAttribute(
              'Target',
              `mailto:${mapped.alias}@anonymized.invalid`
            )
            commentsRelsModified = true
            processedMentionHyperlinks.add(hl)
          } else {
            if (textNodes.length > 0) {
              textNodes[0].textContent = '@Người khác'
              for (let k = 1; k < textNodes.length; k++) {
                textNodes[k].textContent = ''
              }
              commentsModified = true
            }
            relEl.setAttribute(
              'Target',
              'mailto:nguoi-khac@anonymized.invalid'
            )
            commentsRelsModified = true
            processedMentionHyperlinks.add(hl)
            warnings.push(
              `Không tìm thấy danh tính cho liên kết mailto '${target}'. Đã đổi thành 'mailto:nguoi-khac@anonymized.invalid'.`
            )
          }
        }
      }

      // Process any remaining mailto: in comments.xml.rels (orphan or not referenced by hyperlink)
      if (commentsRelsDoc) {
        const relEls = commentsRelsDoc.getElementsByTagNameNS(
          OOXML_NAMESPACES.rels,
          'Relationship'
        )
        for (let i = 0; i < relEls.length; i++) {
          const rel = relEls[i]
          const target = rel.getAttribute('Target') || ''
          if (
            target.toLowerCase().startsWith('mailto:') &&
            !target.endsWith('@anonymized.invalid')
          ) {
            const rawEmail = target.slice('mailto:'.length).trim().toLowerCase()
            const mapped = findMappedForMention(rawEmail, '')
            if (mapped) {
              rel.setAttribute(
                'Target',
                `mailto:${mapped.alias}@anonymized.invalid`
              )
              commentsRelsModified = true
            } else {
              rel.setAttribute(
                'Target',
                'mailto:nguoi-khac@anonymized.invalid'
              )
              commentsRelsModified = true
              warnings.push(
                `Không tìm thấy danh tính cho liên kết mailto '${target}'. Đã đổi thành 'mailto:nguoi-khac@anonymized.invalid'.`
              )
            }
          }
        }
      }
    }

    // Process plain text inside comments: plain text @mentions and/or full names in text
    if (opts.replaceMentions || opts.replaceNamesInCommentText) {
      const textEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')
      for (let i = 0; i < textEls.length; i++) {
        const textNode = textEls[i]
        // If this textNode is inside a w:hyperlink mention that was already processed, skip to avoid double replacing
        const hl = findNearestHyperlinkAncestor(textNode)
        if (hl && processedMentionHyperlinks.has(hl)) {
          continue
        }

        let currentText = textNode.textContent || ''
        let textChanged = false

        for (const [authorName, mapped] of Object.entries(mapping)) {
          if (opts.replaceMentions) {
            const mentionPattern = new RegExp(`@${escapeRegex(authorName)}`, 'g')
            if (mentionPattern.test(currentText)) {
              currentText = currentText.replace(mentionPattern, `@${mapped.label}`)
              textChanged = true
            }
          }

          if (opts.replaceNamesInCommentText) {
            const namePattern = new RegExp(escapeRegex(authorName), 'g')
            if (namePattern.test(currentText)) {
              currentText = currentText.replace(namePattern, mapped.label)
              textChanged = true
            }
          }
        }

        if (textChanged) {
          textNode.textContent = currentText
          commentsModified = true
        }
      }
    }

    if (commentsModified) {
      zip.file('word/comments.xml', serializeXml(doc))
      modifiedParts.push('word/comments.xml')
    }
  }

  // Save modified word/_rels/comments.xml.rels
  if (commentsRelsModified && commentsRelsDoc) {
    zip.file('word/_rels/comments.xml.rels', serializeXml(commentsRelsDoc))
    modifiedParts.push('word/_rels/comments.xml.rels')
  }

  // 2. Process all other XML parts under word/ (revisions in document, header, footer, etc.)
  const entries = Object.keys(zip.files)
  for (const path of entries) {
    if (!path.startsWith('word/') || !path.endsWith('.xml')) continue
    if (
      path === 'word/comments.xml' ||
      path === 'word/people.xml' ||
      path === 'word/commentsExtended.xml' ||
      path === 'word/commentsIds.xml'
    ) {
      continue
    }

    const file = zip.file(path)
    if (!file) continue

    const xmlText = await file.async('string')
    const doc = parseXml(xmlText)
    let partModified = false

    const allEls = doc.getElementsByTagName('*')
    for (let i = 0; i < allEls.length; i++) {
      const el = allEls[i]
      const attrs = Array.from(el.attributes)

      for (const attr of attrs) {
        if (
          attr.localName === 'author' &&
          attr.namespaceURI === OOXML_NAMESPACES.w &&
          attr.value
        ) {
          const mapped = getMapped(attr.value)
          if (mapped) {
            attr.value = mapped.label
            partModified = true
          }
        }

        if (opts.removeDates) {
          if (
            attr.localName === 'date' &&
            attr.namespaceURI === OOXML_NAMESPACES.w
          ) {
            el.removeAttributeNode(attr)
            partModified = true
          } else if (
            attr.localName === 'dateUtc' &&
            (attr.namespaceURI?.startsWith('http://schemas.microsoft.com/office/word/') ||
              attr.namespaceURI === OOXML_NAMESPACES.w16du ||
              attr.namespaceURI === OOXML_NAMESPACES.w16cex)
          ) {
            el.removeAttributeNode(attr)
            partModified = true
          }
        }
      }
    }

    if (partModified) {
      zip.file(path, serializeXml(doc))
      modifiedParts.push(path)
    }
  }

  // 3. Handle date removal in commentsExtended if opts.removeDates is true
  if (opts.removeDates) {
    for (const extendedPath of ['word/commentsExtended.xml', 'word/commentsIds.xml']) {
      const extFile = zip.file(extendedPath)
      if (extFile) {
        const xmlText = await extFile.async('string')
        const doc = parseXml(xmlText)
        let extModified = false

        const allEls = doc.getElementsByTagName('*')
        for (let i = 0; i < allEls.length; i++) {
          const el = allEls[i]
          const attrs = Array.from(el.attributes)
          for (const attr of attrs) {
            if (
              (attr.localName === 'dateUtc' || attr.localName === 'date') &&
              (attr.namespaceURI?.startsWith('http://schemas.microsoft.com/office/word/') ||
                attr.namespaceURI === OOXML_NAMESPACES.w ||
                attr.namespaceURI === OOXML_NAMESPACES.w16du ||
                attr.namespaceURI === OOXML_NAMESPACES.w16cex)
            ) {
              el.removeAttributeNode(attr)
              extModified = true
            }
          }
        }

        if (extModified) {
          zip.file(extendedPath, serializeXml(doc))
          modifiedParts.push(extendedPath)
        }
      }
    }
  }

  // 4. Process word/people.xml
  const peopleFile = zip.file('word/people.xml')
  if (peopleFile) {
    const xmlText = await peopleFile.async('string')
    const doc = parseXml(xmlText)
    let peopleModified = false

    const personEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w15, 'person')
    for (let i = 0; i < personEls.length; i++) {
      const personEl = personEls[i]
      const author =
        personEl.getAttributeNS(OOXML_NAMESPACES.w15, 'author') ||
        personEl.getAttribute('author')

      if (author) {
        const mapped = getMapped(author)
        if (mapped) {
          if (personEl.hasAttributeNS(OOXML_NAMESPACES.w15, 'author')) {
            const attr = personEl.getAttributeNodeNS(OOXML_NAMESPACES.w15, 'author')
            if (attr) attr.value = mapped.label
          } else {
            personEl.setAttribute('author', mapped.label)
          }
          peopleModified = true
        }
      }

      // Xoá phần tử w15:presenceInfo
      const presenceEls = Array.from(
        personEl.getElementsByTagNameNS(OOXML_NAMESPACES.w15, 'presenceInfo')
      )
      for (const presence of presenceEls) {
        personEl.removeChild(presence)
        peopleModified = true
      }
    }

    if (peopleModified) {
      zip.file('word/people.xml', serializeXml(doc))
      modifiedParts.push('word/people.xml')
    }
  }

  // 5. Process docProps/core.xml
  if (opts.scrubDocProps) {
    const coreFile = zip.file('docProps/core.xml')
    if (coreFile) {
      const xmlText = await coreFile.async('string')
      const doc = parseXml(xmlText)
      let coreModified = false

      const creatorEl = doc.getElementsByTagNameNS(OOXML_NAMESPACES.dc, 'creator')[0]
      if (creatorEl) {
        creatorEl.textContent = 'Anonymized'
        coreModified = true
      }

      const modifiedByEl = doc.getElementsByTagNameNS(
        OOXML_NAMESPACES.coreProps,
        'lastModifiedBy'
      )[0]
      if (modifiedByEl) {
        modifiedByEl.textContent = 'Anonymized'
        coreModified = true
      }

      const lastPrintedEl = doc.getElementsByTagNameNS(
        OOXML_NAMESPACES.coreProps,
        'lastPrinted'
      )[0]
      if (lastPrintedEl && lastPrintedEl.parentNode) {
        lastPrintedEl.parentNode.removeChild(lastPrintedEl)
        coreModified = true
      }

      if (coreModified) {
        zip.file('docProps/core.xml', serializeXml(doc))
        modifiedParts.push('docProps/core.xml')
      }
    }
  }

  // 6. Process docProps/app.xml
  if (opts.scrubDocProps) {
    const appFile = zip.file('docProps/app.xml')
    if (appFile) {
      const xmlText = await appFile.async('string')
      const doc = parseXml(xmlText)
      let appModified = false

      for (const tag of ['Company', 'Manager', 'HyperlinkBase']) {
        const el = doc.getElementsByTagNameNS(OOXML_NAMESPACES.appProps, tag)[0]
        if (el) {
          el.textContent = ''
          appModified = true
        }
      }

      const templateEl = doc.getElementsByTagNameNS(
        OOXML_NAMESPACES.appProps,
        'Template'
      )[0]
      if (templateEl) {
        templateEl.textContent = 'Normal.dotm'
        appModified = true
      }

      if (appModified) {
        zip.file('docProps/app.xml', serializeXml(doc))
        modifiedParts.push('docProps/app.xml')
      }
    }
  }

  // 7. Process docProps/custom.xml
  const customFile = zip.file('docProps/custom.xml')
  if (customFile) {
    const xmlText = await customFile.async('string')
    const doc = parseXml(xmlText)
    let customModified = false

    if (opts.customPropsPolicy === 'remove-all') {
      const root = doc.documentElement
      while (root.firstChild) {
        root.removeChild(root.firstChild)
      }
      customModified = true
    } else if (opts.customPropsPolicy === 'keep-sensitivity-labels') {
      const propEls = Array.from(
        doc.getElementsByTagNameNS(OOXML_NAMESPACES.customProps, 'property')
      )
      for (const prop of propEls) {
        const name = prop.getAttribute('name') || ''
        if (!name.startsWith('MSIP_Label_')) {
          prop.parentNode?.removeChild(prop)
          customModified = true
        }
      }
    }

    if (customModified) {
      zip.file('docProps/custom.xml', serializeXml(doc))
      modifiedParts.push('docProps/custom.xml')
    }
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 6,
    },
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  return {
    blob,
    report: {
      identities: inspection.identities,
      mapping,
      modifiedParts,
      warnings,
    },
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
