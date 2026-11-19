import { OOXML_NAMESPACES } from './constants'
import { inspectLoadedDocx } from './inspect'
import { normalizeString } from './normalize'
import { maskPhone, normalizePhone } from './sensitive'
import { replaceTextInXmlDocument } from './textReplace'
import {
  AnonymizeOptions,
  AnonymizeReplacements,
  AnonymizeResult,
  CustomEntity,
  IdentityMapping,
  MappedIdentity,
} from './types'
import { parseXml, serializeXml } from './xml'
import { loadSafeDocx } from './zip'

const DEFAULT_OPTIONS: Required<AnonymizeOptions> = {
  removeDates: false,
  replaceMentions: true,
  replaceNamesInCommentText: false,
  scrubDocProps: true,
  customPropsPolicy: 'keep-sensitivity-labels',
  customEntities: [],
  maskKinds: {
    email: true,
    phone: true,
    nationalId: true,
    taxCode: true,
    bankAccount: true,
    address: true,
  },
  keepValues: [],
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceEntitiesInMetadataDoc(
  doc: Document,
  entities: CustomEntity[]
): boolean {
  if (entities.length === 0) return false
  let modified = false

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
    let text = (tNode.textContent || '').normalize('NFC')
    let textChanged = false

    for (const entity of entities) {
      for (const val of entity.values) {
        const trimmedVal = val.trim().normalize('NFC')
        if (trimmedVal.length < 2) continue

        const valLower = trimmedVal.toLowerCase()
        const textLower = text.toLowerCase()

        if (textLower.includes(valLower)) {
          const regex = new RegExp(
            `(?<![\\p{L}\\p{N}])${escapeRegex(trimmedVal)}(?![\\p{L}\\p{N}])`,
            'gui'
          )
          if (regex.test(text)) {
            text = text.replace(regex, entity.label)
            textChanged = true
          }
        }
      }
    }

    if (textChanged) {
      tNode.textContent = text
      modified = true
    }
  }

  return modified
}

// TODO(verify): Cấu trúc mention w:hyperlink kết hợp mailto: - Word 365 dùng w:hyperlink trỏ rel mailto, cần kiểm tra thêm khi mention nằm trong comment phức tạp hoặc phân tách nhiều w:r/w:t.
export async function anonymizeDocx(
  input: ArrayBuffer,
  mapping: IdentityMapping,
  options?: Partial<AnonymizeOptions>
): Promise<AnonymizeResult> {
  const opts: Required<AnonymizeOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    maskKinds: {
      ...DEFAULT_OPTIONS.maskKinds,
      ...(options?.maskKinds || {}),
    },
    customEntities: options?.customEntities || [],
    keepValues: options?.keepValues || [],
  }
  const zip = await loadSafeDocx(input)
  const inspection = await inspectLoadedDocx(zip, opts.customEntities)

  const modifiedParts: string[] = []
  const warnings: string[] = [...inspection.warnings]
  const processedMentionHyperlinks = new Set<Element>()

  const replacements: AnonymizeReplacements = {
    entities: 0,
    byKind: {
      email: 0,
      phone: 0,
      nationalId: 0,
      taxCode: 0,
      bankAccount: 0,
      address: 0,
    },
  }

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
    for (const ident of inspection.identities) {
      if (ident.email && ident.email.toLowerCase() === email.toLowerCase()) {
        const mapped = getMapped(ident.author)
        if (mapped) return mapped
      }
    }

    if (displayText) {
      const mapped = getMapped(displayText)
      if (mapped) return mapped
    }

    return getMapped(email)
  }

  // 1. Process word/comments.xml (participant metadata & author mentions)
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
            if (textNodes.length > 0) {
              textNodes[0].textContent = `@${mapped.label}`
              for (let k = 1; k < textNodes.length; k++) {
                textNodes[k].textContent = ''
              }
              commentsModified = true
            }

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

      // Process any remaining mailto: in comments.xml.rels
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

    // Process plain text inside comments for participants
    if (opts.replaceMentions || opts.replaceNamesInCommentText) {
      const textEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')
      for (let i = 0; i < textEls.length; i++) {
        const textNode = textEls[i]
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

  // 2. Process all other XML parts under word/ for revisions
  const entries = Object.keys(zip.files).sort()
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

  // ==========================================
  // W-5a: Text replacement (entities + sensitive)
  // ==========================================

  // Determine which emails and phones are masked to update links/fields
  const isEmailMasked = (email: string): boolean => {
    if (!opts.maskKinds.email) return false
    const norm = email.trim().toLowerCase()
    return !opts.keepValues.includes(norm)
  }

  const isPhoneMasked = (phone: string): { masked: boolean; maskedValue: string } => {
    if (!opts.maskKinds.phone) return { masked: false, maskedValue: phone }
    const norm = normalizePhone(phone)
    if (!norm) return { masked: false, maskedValue: phone }
    if (opts.keepValues.includes(norm)) return { masked: false, maskedValue: phone }
    return { masked: true, maskedValue: maskPhone(norm) }
  }

  // 8. Run paragraph text replacement on all document text parts (document, header, footer, footnote, endnote, comments, etc.)
  for (const path of entries) {
    if (!path.startsWith('word/') || !path.endsWith('.xml') || path === 'word/people.xml') {
      continue
    }

    const file = zip.file(path)
    if (!file) continue

    const xmlText = await file.async('string')
    const doc = parseXml(xmlText)

    let docModified = replaceTextInXmlDocument(
      doc,
      {
        customEntities: opts.customEntities,
        maskKinds: opts.maskKinds,
        keepValues: opts.keepValues,
      },
      replacements
    )

    // Also replace HYPERLINK field codes in w:instrText and w:fldSimple
    const fldSimples = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'fldSimple')
    for (let i = 0; i < fldSimples.length; i++) {
      const el = fldSimples[i]
      const instr = el.getAttributeNS(OOXML_NAMESPACES.w, 'instr') || ''
      if (/HYPERLINK/i.test(instr)) {
        let newInstr = instr
        // mailto:
        const mailtoMatch = instr.match(/mailto:([^\s"]+)/i)
        if (mailtoMatch && isEmailMasked(mailtoMatch[1])) {
          newInstr = newInstr.replace(
            /mailto:[^\s"]+/i,
            'mailto:masked@anonymized.invalid'
          )
        }
        // tel:
        const telMatch = instr.match(/tel:([^\s"]+)/i)
        if (telMatch) {
          const { masked, maskedValue } = isPhoneMasked(telMatch[1])
          if (masked) {
            newInstr = newInstr.replace(/tel:[^\s"]+/i, `tel:${maskedValue}`)
          }
        }
        if (newInstr !== instr) {
          el.setAttributeNS(OOXML_NAMESPACES.w, 'instr', newInstr)
          docModified = true
        }
      }
    }

    const instrTexts = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'instrText')
    for (let i = 0; i < instrTexts.length; i++) {
      const el = instrTexts[i]
      const instr = el.textContent || ''
      if (/HYPERLINK/i.test(instr)) {
        let newInstr = instr
        const mailtoMatch = instr.match(/mailto:([^\s"]+)/i)
        if (mailtoMatch && isEmailMasked(mailtoMatch[1])) {
          newInstr = newInstr.replace(
            /mailto:[^\s"]+/i,
            'mailto:masked@anonymized.invalid'
          )
        }
        const telMatch = instr.match(/tel:([^\s"]+)/i)
        if (telMatch) {
          const { masked, maskedValue } = isPhoneMasked(telMatch[1])
          if (masked) {
            newInstr = newInstr.replace(/tel:[^\s"]+/i, `tel:${maskedValue}`)
          }
        }
        if (newInstr !== instr) {
          el.textContent = newInstr
          docModified = true
        }
      }
    }

    if (docModified) {
      zip.file(path, serializeXml(doc))
      if (!modifiedParts.includes(path)) {
        modifiedParts.push(path)
      }
    }
  }

  // 9. Process links in ALL .rels files EXCEPT comments.xml.rels (comments mentions handled in step 1)
  for (const path of entries) {
    if (!path.endsWith('.rels')) continue
    if (path === 'word/_rels/comments.xml.rels') continue

    const file = zip.file(path)
    if (!file) continue

    const xmlText = await file.async('string')
    const doc = parseXml(xmlText)
    let relsModified = false

    const relEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.rels, 'Relationship')
    for (let i = 0; i < relEls.length; i++) {
      const rel = relEls[i]
      const target = rel.getAttribute('Target') || ''

      if (target.toLowerCase().startsWith('mailto:')) {
        const rawEmail = target.slice('mailto:'.length).trim()
        if (
          !rawEmail.toLowerCase().endsWith('@anonymized.invalid') &&
          isEmailMasked(rawEmail)
        ) {
          rel.setAttribute('Target', 'mailto:masked@anonymized.invalid')
          relsModified = true
        }
      } else if (target.toLowerCase().startsWith('tel:')) {
        const rawPhone = target.slice('tel:'.length).trim()
        const { masked, maskedValue } = isPhoneMasked(rawPhone)
        if (masked) {
          rel.setAttribute('Target', `tel:${maskedValue}`)
          relsModified = true
        }
      }
    }

    if (relsModified) {
      zip.file(path, serializeXml(doc))
      if (!modifiedParts.includes(path)) {
        modifiedParts.push(path)
      }
    }
  }

  // 10. Replace entities in docProps metadata (core.xml, app.xml, custom.xml)
  for (const metaPath of ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml']) {
    const file = zip.file(metaPath)
    if (!file) continue

    const xmlText = await file.async('string')
    const doc = parseXml(xmlText)

    if (replaceEntitiesInMetadataDoc(doc, opts.customEntities)) {
      zip.file(metaPath, serializeXml(doc))
      if (!modifiedParts.includes(metaPath)) {
        modifiedParts.push(metaPath)
      }
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
      replacements,
    },
  }
}
