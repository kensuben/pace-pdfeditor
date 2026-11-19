import { OOXML_NAMESPACES } from './constants'
import { findSensitive, maskAddress, maskSensitive } from './sensitive'
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

function subtractRanges(
  rangeStart: number,
  rangeEnd: number,
  occupied: { start: number; end: number }[]
): [number, number][] {
  const relevant = occupied
    .map((o) => ({
      start: Math.max(rangeStart, o.start),
      end: Math.min(rangeEnd, o.end),
    }))
    .filter((o) => o.start < o.end)
    .sort((a, b) => a.start - b.start)

  if (relevant.length === 0) {
    return [[rangeStart, rangeEnd]]
  }

  const merged: { start: number; end: number }[] = []
  for (const seg of relevant) {
    if (merged.length === 0) {
      merged.push({ ...seg })
    } else {
      const last = merged[merged.length - 1]
      if (seg.start <= last.end) {
        last.end = Math.max(last.end, seg.end)
      } else {
        merged.push({ ...seg })
      }
    }
  }

  const result: [number, number][] = []
  let cursor = rangeStart
  for (const m of merged) {
    if (m.start > cursor) {
      result.push([cursor, m.start])
    }
    cursor = Math.max(cursor, m.end)
  }
  if (cursor < rangeEnd) {
    result.push([cursor, rangeEnd])
  }

  return result
}

export function findEntityMatches(
  text: string,
  entities: CustomEntity[]
): ReplacementSpan[] {
  const spans: ReplacementSpan[] = []
  // text is already normalized to NFC by caller
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

  // NFD safety (Requirement 3):
  // Normalize each w:t node to NFC and write it back so paragraph text and nodes share exact same NFC string.
  let paraText = ''
  const nodeRanges: { node: Element; start: number; end: number; originalText: string }[] = []

  for (const node of tNodes) {
    const raw = node.textContent || ''
    const nfc = raw.normalize('NFC')
    if (raw !== nfc) {
      node.textContent = nfc
    }
    const start = paraText.length
    paraText += nfc
    const end = paraText.length
    nodeRanges.push({ node, start, end, originalText: nfc })
  }

  if (paraText.length === 0) return false

  // Step (a): Entity matches
  const entitySpans = findEntityMatches(paraText, customEntities)
  const occupiedRanges: { start: number; end: number }[] = entitySpans.map((s) => ({
    start: s.start,
    end: s.end,
  }))

  // Step (b): Detect sensitive data (email, phone, CCCD, MST, STK) outside entity ranges
  const allSensitive = findSensitive(paraText)
  const specificMatches = allSensitive.filter((s) => s.kind !== 'address')
  const specificSpans: ReplacementSpan[] = []

  for (const sMatch of specificMatches) {
    if (!maskKinds[sMatch.kind]) continue
    if (keepValues.includes(sMatch.normalized)) continue

    // Skip if overlaps with any entity span
    const overlapsEntity = entitySpans.some(
      (e) => Math.max(sMatch.start, e.start) < Math.min(sMatch.end, e.end)
    )
    if (overlapsEntity) continue

    const replacementText = maskSensitive(sMatch.kind, sMatch.value, sMatch.normalized)
    specificSpans.push({
      start: sMatch.start,
      end: sMatch.end,
      replacementText,
      type: 'sensitive',
      kind: sMatch.kind,
    })
    occupiedRanges.push({ start: sMatch.start, end: sMatch.end })
  }

  // Step (c): Address masking outside entity and step (b) ranges
  const addressMatches = allSensitive.filter((s) => s.kind === 'address')
  const addressSpans: ReplacementSpan[] = []

  if (maskKinds.address) {
    for (const addrMatch of addressMatches) {
      if (keepValues.includes(addrMatch.normalized)) continue

      const subRanges = subtractRanges(
        addrMatch.start,
        addrMatch.end,
        occupiedRanges
      )

      let addrReplaced = false
      for (const [subStart, subEnd] of subRanges) {
        const subRaw = paraText.slice(subStart, subEnd)
        const trimmed = subRaw.trim()
        if (trimmed.length < 3) continue

        const leadingSpace = subRaw.length - subRaw.trimStart().length
        const actualStart = subStart + leadingSpace
        const actualEnd = actualStart + trimmed.length
        const replacementText = maskAddress(trimmed)

        addressSpans.push({
          start: actualStart,
          end: actualEnd,
          replacementText,
          type: 'sensitive',
          kind: 'address',
        })
        addrReplaced = true
      }

      if (addrReplaced) {
        stats.byKind.address++
      }
    }
  }

  const allSpans = [...entitySpans, ...specificSpans, ...addressSpans]
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
        } else if (span.kind && span.kind !== 'address') {
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
