import { OOXML_NAMESPACES } from './constants'
import { inspectLoadedDocx } from './inspect'
import { normalizeString } from './normalize'
import {
  AnonymizeOptions,
  AnonymizeResult,
  IdentityMapping,
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

export async function anonymizeDocx(
  input: ArrayBuffer,
  mapping: IdentityMapping,
  options?: Partial<AnonymizeOptions>
): Promise<AnonymizeResult> {
  const opts: AnonymizeOptions = { ...DEFAULT_OPTIONS, ...options }
  const zip = await loadSafeDocx(input)
  const inspection = await inspectLoadedDocx(zip)

  const modifiedParts: string[] = []

  // Build a lookup function for mapping
  const getMapped = (rawAuthor: string) => {
    const key = normalizeString(rawAuthor)
    return mapping[key]
  }

  // Find author index for mention email generation
  const authorIndexMap = new Map<string, number>()
  Object.keys(mapping).forEach((key, idx) => {
    authorIndexMap.set(key, idx + 1)
  })

  // 1. Process word/comments.xml
  const commentsFile = zip.file('word/comments.xml')
  if (commentsFile) {
    const xmlText = await commentsFile.async('string')
    const doc = parseXml(xmlText)
    let commentsModified = false

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

        const dateUtcAttr =
          commentEl.getAttributeNodeNS(OOXML_NAMESPACES.w16du, 'dateUtc') ||
          commentEl.getAttributeNodeNS(OOXML_NAMESPACES.w16cex, 'dateUtc')
        if (dateUtcAttr) {
          commentEl.removeAttributeNode(dateUtcAttr)
          commentsModified = true
        }
      }
    }

    // Process text inside comments: mentions and/or names in text
    if (opts.replaceMentions || opts.replaceNamesInCommentText) {
      const textEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')
      for (let i = 0; i < textEls.length; i++) {
        const textNode = textEls[i]
        let currentText = textNode.textContent || ''
        let textChanged = false

        for (const [authorName, mapped] of Object.entries(mapping)) {
          if (opts.replaceMentions) {
            // Replace @Mention with @Label
            const mentionPattern = new RegExp(`@${escapeRegex(authorName)}`, 'g')
            if (mentionPattern.test(currentText)) {
              currentText = currentText.replace(mentionPattern, `@${mapped.label}`)
              textChanged = true
            }
          }

          if (opts.replaceNamesInCommentText) {
            // Replace bare full name
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

  // 2. Process word/_rels/comments.xml.rels for mailto mentions
  const commentsRelsFile = zip.file('word/_rels/comments.xml.rels')
  if (commentsRelsFile && opts.replaceMentions) {
    const xmlText = await commentsRelsFile.async('string')
    const doc = parseXml(xmlText)
    let relsModified = false

    const relEls = doc.getElementsByTagNameNS(OOXML_NAMESPACES.rels, 'Relationship')
    for (let i = 0; i < relEls.length; i++) {
      const rel = relEls[i]
      const target = rel.getAttribute('Target')
      if (target && target.startsWith('mailto:')) {
        const email = target.slice('mailto:'.length)
        // Find which author index matches this email, or fallback to index 1
        let matchedIndex = 1
        let found = false

        // 1. Try matching with known identities that have this email
        for (const ident of inspection.identities) {
          if (ident.email && ident.email.toLowerCase() === email.toLowerCase()) {
            const mapped = getMapped(ident.author)
            const numMatch = mapped?.label.match(/\d+/)
            matchedIndex = numMatch ? parseInt(numMatch[0], 10) : authorIndexMap.get(ident.author) || 1
            found = true
            break
          }
        }

        // 2. Try matching author name in mapping with email prefix
        if (!found) {
          const emailPrefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
          for (const [authorName, mapped] of Object.entries(mapping)) {
            const authorNorm = authorName
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[đĐ]/g, 'd')
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')

            if (
              (authorNorm.length > 2 && emailPrefix.includes(authorNorm)) ||
              (emailPrefix.length > 2 && authorNorm.includes(emailPrefix))
            ) {
              const numMatch = mapped.label.match(/\d+/)
              matchedIndex = numMatch ? parseInt(numMatch[0], 10) : authorIndexMap.get(authorName) || 1
              break
            }
          }
        }

        const newTarget = `mailto:nguoi-gop-y-${matchedIndex}@anonymized.invalid`
        rel.setAttribute('Target', newTarget)
        relsModified = true
      }
    }

    if (relsModified) {
      zip.file('word/_rels/comments.xml.rels', serializeXml(doc))
      modifiedParts.push('word/_rels/comments.xml.rels')
    }
  }

  // 3. Process all other XML parts under word/ (revisions in document, header, footer, etc.)
  const entries = Object.keys(zip.files)
  for (const path of entries) {
    if (!path.startsWith('word/') || !path.endsWith('.xml')) continue
    // Specific parts handled separately
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
            (attr.namespaceURI === OOXML_NAMESPACES.w16du ||
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

  // 4. Handle date removal in commentsExtended if opts.removeDates is true
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
              (attr.namespaceURI === OOXML_NAMESPACES.w ||
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

  // 5. Process word/people.xml
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

  // 6. Process docProps/core.xml
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

  // 7. Process docProps/app.xml
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

  // 8. Process docProps/custom.xml
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
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  return {
    blob,
    report: {
      identities: inspection.identities,
      mapping,
      modifiedParts,
      warnings: inspection.warnings,
    },
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
