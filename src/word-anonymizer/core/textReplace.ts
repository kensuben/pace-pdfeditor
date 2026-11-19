import { OOXML_NAMESPACES } from './constants'
import { findSensitive, maskSensitive } from './sensitive'
import {
  AnonymizeOptions,
  AnonymizeReplacements,
  CustomEntity,
  SensitiveKind,
} from './types'

interface ReplacementSpan {
  start: number
  end: number
  replacementText: string
  type: 'entity' | 'sensitive'
  kind?: SensitiveKind
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

function isWordChar(char: string | undefined): boolean {
  if (!char) return false
  return /[\p{L}\p{N}]/u.test(char)
}

export function findEntityMatches(
  text: string,
  entities: CustomEntity[]
): ReplacementSpan[] {
  const spans: ReplacementSpan[] = []
  const textNormalized = text.normalize('NFC')
  const textLower = textNormalized.toLowerCase()

  for (const entity of entities) {
    for (const valRaw of entity.values) {
      const val = valRaw.trim().normalize('NFC')
      if (val.length < 2) continue

      const valLower = val.toLowerCase()
      let searchPos = 0

      while (searchPos < textLower.length) {
        const foundPos = textLower.indexOf(valLower, searchPos)
        if (foundPos === -1) break

        const matchEnd = foundPos + val.length
        const charBefore = foundPos > 0 ? textNormalized[foundPos - 1] : undefined
        const charAfter =
          matchEnd < textNormalized.length ? textNormalized[matchEnd] : undefined

        // Whole word check: boundary must be non-word characters
        if (!isWordChar(charBefore) && !isWordChar(charAfter)) {
          spans.push({
            start: foundPos,
            end: matchEnd,
            replacementText: entity.label,
            type: 'entity',
          })
        }

        searchPos = foundPos + 1
      }
    }
  }

  // Priority: longest match first, then earlier start
  spans.sort((a, b) => {
    const lenA = a.end - a.start
    const lenB = b.end - b.start
    if (lenB !== lenA) return lenB - lenA
    return a.start - b.start
  })

  // Filter overlapping spans: longest wins
  const selected: ReplacementSpan[] = []
  for (const span of spans) {
    const overlaps = selected.some(
      (s) => Math.max(span.start, s.start) < Math.min(span.end, s.end)
    )
    if (!overlaps) {
      selected.push(span)
    }
  }

  selected.sort((a, b) => a.start - b.start)
  return selected
}

export function replaceParagraphText(
  p: Element,
  opts: {
    customEntities?: CustomEntity[]
    maskKinds?: Partial<Record<SensitiveKind, boolean>>
    keepValues?: string[]
  },
  stats: AnonymizeReplacements
): boolean {
  const customEntities = opts.customEntities || []
  const maskKinds = opts.maskKinds || {}
  const keepValues = opts.keepValues || []

  const tNodes = getDirectParagraphTNodes(p)
  if (tNodes.length === 0) return false

  // Build concatenated string and node offset map
  let paraText = ''
  const nodeRanges: { node: Element; start: number; end: number; originalText: string }[] = []

  for (const node of tNodes) {
    const originalText = node.textContent || ''
    const start = paraText.length
    paraText += originalText
    const end = paraText.length
    nodeRanges.push({ node, start, end, originalText })
  }

  if (paraText.length === 0) return false

  // 1. Entity matches
  const entitySpans = findEntityMatches(paraText, customEntities)

  // 2. Sensitive data matches
  const sensitiveMatches = findSensitive(paraText)
  const sensitiveSpans: ReplacementSpan[] = []

  for (const sMatch of sensitiveMatches) {
    if (!maskKinds[sMatch.kind]) continue
    if (keepValues.includes(sMatch.normalized)) continue

    // Must not overlap with any entity span (entity replaced first)
    const overlapsEntity = entitySpans.some(
      (e) => Math.max(sMatch.start, e.start) < Math.min(sMatch.end, e.end)
    )
    if (overlapsEntity) continue

    const replacementText = maskSensitive(sMatch.kind, sMatch.value, sMatch.normalized)
    sensitiveSpans.push({
      start: sMatch.start,
      end: sMatch.end,
      replacementText,
      type: 'sensitive',
      kind: sMatch.kind,
    })
  }

  const allSpans = [...entitySpans, ...sensitiveSpans]
  if (allSpans.length === 0) return false

  allSpans.sort((a, b) => a.start - b.start)

  let paragraphModified = false

  // Map replacement spans back onto tNodes
  for (const range of nodeRanges) {
    const { node, start: nodeStart, end: nodeEnd, originalText: nodeText } = range
    let result = ''
    let cursor = nodeStart

    for (const span of allSpans) {
      if (span.end <= nodeStart || span.start >= nodeEnd) continue

      if (span.start > cursor) {
        result += nodeText.slice(cursor - nodeStart, Math.min(span.start, nodeEnd) - nodeStart)
      }

      if (span.start >= nodeStart && span.start < nodeEnd) {
        result += span.replacementText
        // Count replacement
        if (span.type === 'entity') {
          stats.entities++
        } else if (span.kind) {
          stats.byKind[span.kind]++
        }
      }

      cursor = Math.min(span.end, nodeEnd)
    }

    if (cursor < nodeEnd) {
      result += nodeText.slice(cursor - nodeStart)
    }

    if (result !== nodeText) {
      node.textContent = result
      if (/^\s|\s$/.test(result)) {
        node.setAttribute('xml:space', 'preserve')
      }
      paragraphModified = true
    }
  }

  return paragraphModified
}

export function replaceTextInXmlDocument(
  doc: Document,
  opts: Pick<AnonymizeOptions, 'customEntities' | 'maskKinds' | 'keepValues'>,
  stats: AnonymizeReplacements
): boolean {
  const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))
  let modified = false

  for (const p of paragraphs) {
    if (replaceParagraphText(p, opts, stats)) {
      modified = true
    }
  }

  return modified
}
