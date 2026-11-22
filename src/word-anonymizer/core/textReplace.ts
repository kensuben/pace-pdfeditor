import { OOXML_NAMESPACES } from './constants'
import { findSensitive, maskAddress, maskSensitive } from './sensitive'
import {
  AnonymizeOptions,
  AnonymizeReplacements,
  CustomEntity,
  DeletedTextMode,
  KeywordRule,
  SensitiveKind,
} from './types'

export interface ReplacementSpan {
  start: number
  end: number
  replacementText: string
  type: 'entity' | 'sensitive' | 'keyword'
  kind?: SensitiveKind
  ruleId?: string
  matchedText?: string
}

const VIETNAMESE_DIACRITICS_MAP: Record<string, string> = {
  a: '[aàáảãạăằắẳẵặâầấẩẫậ]',
  d: '[dđ]',
  e: '[eèéẻẽẹêềếểễệ]',
  i: '[iìíỉĩị]',
  o: '[oòóỏõọôồốổỗộơờớởỡợ]',
  u: '[uùúủũụưừứửữự]',
  y: '[yỳýỷỹỵ]',
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getDirectParagraphTNodes(
  p: Element,
  localName: 't' | 'delText' = 't'
): Element[] {
  const allNodes = Array.from(p.getElementsByTagNameNS(OOXML_NAMESPACES.w, localName))
  return allNodes.filter((node) => {
    let curr = node.parentElement
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

export function findKeywordMatches(
  text: string,
  rules: KeywordRule[]
): ReplacementSpan[] {
  if (!text || !rules || rules.length === 0) return []
  const textNormalized = text.normalize('NFC')
  const spans: ReplacementSpan[] = []

  for (const rule of rules) {
    const trimmedFind = rule.find.trim().normalize('NFC')
    if (trimmedFind.length < 2) continue

    const tokens = trimmedFind.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue

    const tokenPatterns = tokens.map((token) => {
      let pat = ''
      for (const ch of token) {
        if (rule.ignoreDiacritics) {
          const base = ch
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[đĐ]/g, 'd')
            .toLowerCase()
          if (VIETNAMESE_DIACRITICS_MAP[base]) {
            pat += `(?:${VIETNAMESE_DIACRITICS_MAP[base]}[\\u0300-\\u036f]*)`
          } else {
            pat += escapeRegex(ch)
          }
        } else {
          pat += escapeRegex(ch)
        }
      }
      return pat
    })

    const fullPattern = tokenPatterns.join('\\s+')
    let regex: RegExp
    try {
      regex = new RegExp(fullPattern, 'gui')
    } catch {
      continue
    }

    const replacementText =
      !rule.replace || rule.replace.trim() === '' ? '****' : rule.replace

    let m: RegExpExecArray | null
    while ((m = regex.exec(textNormalized)) !== null) {
      const matchStart = m.index
      const matchEnd = m.index + m[0].length

      if (matchEnd > matchStart) {
        const firstMatchChar = textNormalized[matchStart]
        const lastMatchChar = textNormalized[matchEnd - 1]
        const charBefore = matchStart > 0 ? textNormalized[matchStart - 1] : undefined
        const charAfter =
          matchEnd < textNormalized.length ? textNormalized[matchEnd] : undefined

        const validBoundaryBefore = !isWordChar(firstMatchChar) || !isWordChar(charBefore)
        const validBoundaryAfter = !isWordChar(lastMatchChar) || !isWordChar(charAfter)

        if (validBoundaryBefore && validBoundaryAfter) {
          spans.push({
            start: matchStart,
            end: matchEnd,
            replacementText,
            type: 'keyword',
            ruleId: rule.id,
            matchedText: m[0],
          })
        }
      }

      regex.lastIndex = matchStart + 1
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

export function replaceKeywordsInString(
  text: string,
  rules: KeywordRule[]
): { text: string; count: number } {
  if (!text || !rules || rules.length === 0) return { text, count: 0 }
  const matches = findKeywordMatches(text, rules)
  if (matches.length === 0) return { text, count: 0 }

  const sorted = [...matches].sort((a, b) => b.start - a.start)
  let result = text
  for (const m of sorted) {
    result = result.slice(0, m.start) + m.replacementText + result.slice(m.end)
  }
  return { text: result, count: matches.length }
}

export function replaceNodeListText(
  nodes: Element[],
  opts: {
    customEntities?: CustomEntity[]
    maskKinds?: Partial<Record<SensitiveKind, boolean>>
    keepValues?: string[]
    keywordRules?: KeywordRule[]
  },
  stats: AnonymizeReplacements
): boolean {
  if (nodes.length === 0) return false

  const customEntities = opts.customEntities || []
  const maskKinds = opts.maskKinds || {}
  const keepValues = opts.keepValues || []
  const keywordRules = opts.keywordRules || []

  // NFD safety (Requirement 3):
  // Normalize each node to NFC and write it back so paragraph text and nodes share exact same NFC string.
  let streamText = ''
  const nodeRanges: { node: Element; start: number; end: number; originalText: string }[] = []

  for (const node of nodes) {
    const raw = node.textContent || ''
    const nfc = raw.normalize('NFC')
    if (raw !== nfc) {
      node.textContent = nfc
    }
    const start = streamText.length
    streamText += nfc
    const end = streamText.length
    nodeRanges.push({ node, start, end, originalText: nfc })
  }

  if (streamText.length === 0) return false

  // Step (a): Entity matches
  const entitySpans = findEntityMatches(streamText, customEntities)
  const occupiedRanges: { start: number; end: number }[] = entitySpans.map((s) => ({
    start: s.start,
    end: s.end,
  }))

  // Step (b): Keyword matches (outside entity ranges)
  const rawKeywordSpans = findKeywordMatches(streamText, keywordRules)
  const keywordSpans: ReplacementSpan[] = []
  for (const kSpan of rawKeywordSpans) {
    const overlapsEntity = occupiedRanges.some(
      (occ) => Math.max(kSpan.start, occ.start) < Math.min(kSpan.end, occ.end)
    )
    if (!overlapsEntity) {
      keywordSpans.push(kSpan)
      occupiedRanges.push({ start: kSpan.start, end: kSpan.end })
    }
  }

  // Step (c): Detect sensitive data (email, phone, CCCD, MST, STK) outside entity and keyword ranges
  const allSensitive = findSensitive(streamText)
  const specificMatches = allSensitive.filter((s) => s.kind !== 'address')
  const specificSpans: ReplacementSpan[] = []

  for (const sMatch of specificMatches) {
    if (!maskKinds[sMatch.kind]) continue
    if (keepValues.includes(sMatch.normalized)) continue

    const overlapsOccupied = occupiedRanges.some(
      (occ) => Math.max(sMatch.start, occ.start) < Math.min(sMatch.end, occ.end)
    )
    if (overlapsOccupied) continue

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

  // Step (d): Address masking outside entity, keyword, and step (c) ranges
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
        const subRaw = streamText.slice(subStart, subEnd)
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

  const allSpans = [...entitySpans, ...keywordSpans, ...specificSpans, ...addressSpans]
  if (allSpans.length === 0) return false

  allSpans.sort((a, b) => a.start - b.start)

  let streamModified = false

  // Map replacement spans back onto nodes
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
        } else if (span.type === 'keyword') {
          stats.keywords++
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
      streamModified = true
    }
  }

  return streamModified
}

export interface StreamNodeRange {
  node: Element
  start: number
  end: number
  originalText: string
  isDelText: boolean
}

export interface ParagraphStream {
  streamText: string
  nodeRanges: StreamNodeRange[]
  virtualSepIndices: number[]
}

function isSeparatorChar(ch: string): boolean {
  return ch === '\t' || ch === '\n' || ch === '\r'
}

export function buildParagraphStream(
  p: Element,
  mode: 'body' | 'original'
): ParagraphStream {
  let streamText = ''
  const nodeRanges: StreamNodeRange[] = []
  const virtualSepIndices: number[] = []

  const walk = (node: Node, inDel: boolean, inIns: boolean) => {
    if (node !== p && node.nodeType === 1 /* Node.ELEMENT_NODE */) {
      const el = node as Element

      // Do not enter nested paragraphs (e.g., nested tables)
      if (el.localName === 'p' && el.namespaceURI === OOXML_NAMESPACES.w) {
        return
      }

      // In body mode: skip all deleted content
      if (mode === 'body' && el.localName === 'del' && el.namespaceURI === OOXML_NAMESPACES.w) {
        return
      }

      // In original mode: skip all inserted content
      if (mode === 'original' && el.localName === 'ins' && el.namespaceURI === OOXML_NAMESPACES.w) {
        return
      }

      const isWordNs = el.namespaceURI === OOXML_NAMESPACES.w || !el.namespaceURI
      if (isWordNs) {
        // Virtual separators
        if (el.localName === 'tab' || el.localName === 'ptab') {
          virtualSepIndices.push(streamText.length)
          streamText += '\t'
          return
        }
        if (el.localName === 'br' || el.localName === 'cr') {
          virtualSepIndices.push(streamText.length)
          streamText += '\n'
          return
        }
        if (el.localName === 'noBreakHyphen') {
          streamText += '-'
          return
        }
        if (el.localName === 'softHyphen') {
          return
        }

        // Text nodes
        if (el.localName === 't' && (!inDel || mode === 'body')) {
          const raw = el.textContent || ''
          const nfc = raw.normalize('NFC')
          if (raw !== nfc) {
            el.textContent = nfc
          }
          const start = streamText.length
          streamText += nfc
          const end = streamText.length
          nodeRanges.push({
            node: el,
            start,
            end,
            originalText: nfc,
            isDelText: false,
          })
          return
        }

        if (el.localName === 'delText' && mode === 'original') {
          const raw = el.textContent || ''
          const nfc = raw.normalize('NFC')
          if (raw !== nfc) {
            el.textContent = nfc
          }
          const start = streamText.length
          streamText += nfc
          const end = streamText.length
          nodeRanges.push({
            node: el,
            start,
            end,
            originalText: nfc,
            isDelText: true,
          })
          return
        }
      }

      const nextInDel = inDel || (el.localName === 'del' && el.namespaceURI === OOXML_NAMESPACES.w)
      const nextInIns = inIns || (el.localName === 'ins' && el.namespaceURI === OOXML_NAMESPACES.w)

      for (let i = 0; i < el.childNodes.length; i++) {
        walk(el.childNodes[i], nextInDel, nextInIns)
      }
      return
    }

    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i], inDel, inIns)
    }
  }

  walk(p, false, false)
  return { streamText, nodeRanges, virtualSepIndices }
}

function sanitizeSpansAgainstSeparators(
  spans: ReplacementSpan[],
  streamText: string
): ReplacementSpan[] {
  if (spans.length === 0) return spans

  const result: ReplacementSpan[] = []
  for (const span of spans) {
    let firstSep = -1
    for (let i = span.start + 1; i < span.end; i++) {
      if (isSeparatorChar(streamText[i])) {
        firstSep = i
        break
      }
    }

    if (firstSep === -1) {
      result.push(span)
      continue
    }

    // Straddles a separator!
    // For email / phone / number: discard completely
    const isSensitiveNumberOrEmail =
      span.type === 'sensitive' &&
      (span.kind === 'email' ||
        span.kind === 'phone' ||
        span.kind === 'nationalId' ||
        span.kind === 'taxCode' ||
        span.kind === 'bankAccount')

    if (isSensitiveNumberOrEmail) {
      continue
    }

    // For entity, keyword, address: cut at first separator
    const newEnd = firstSep
    if (newEnd > span.start) {
      const cutText = streamText.slice(span.start, newEnd).trim()
      if (cutText.length >= 2) {
        result.push({
          ...span,
          end: newEnd,
        })
      }
    }
  }

  return result
}

function applySpansToNodeRanges(
  nodeRanges: StreamNodeRange[],
  allSpans: ReplacementSpan[],
  stats: AnonymizeReplacements,
  targetFilter?: (range: StreamNodeRange) => boolean
): boolean {
  let streamModified = false

  for (const range of nodeRanges) {
    if (targetFilter && !targetFilter(range)) {
      continue
    }

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
        } else if (span.type === 'keyword') {
          stats.keywords++
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
      streamModified = true
    }
  }

  return streamModified
}

function replaceParagraphStream(
  stream: ParagraphStream,
  opts: {
    customEntities?: CustomEntity[]
    maskKinds?: Partial<Record<SensitiveKind, boolean>>
    keepValues?: string[]
    keywordRules?: KeywordRule[]
  },
  stats: AnonymizeReplacements,
  targetFilter?: (range: StreamNodeRange) => boolean
): boolean {
  const { streamText, nodeRanges } = stream
  if (streamText.length === 0 || nodeRanges.length === 0) return false

  if (targetFilter && !nodeRanges.some(targetFilter)) return false

  const customEntities = opts.customEntities || []
  const maskKinds = opts.maskKinds || {}
  const keepValues = opts.keepValues || []
  const keywordRules = opts.keywordRules || []

  // Step (a): Entity matches
  const rawEntitySpans = findEntityMatches(streamText, customEntities)
  const entitySpans = sanitizeSpansAgainstSeparators(rawEntitySpans, streamText)
  const occupiedRanges: { start: number; end: number }[] = entitySpans.map((s) => ({
    start: s.start,
    end: s.end,
  }))

  // Step (b): Keyword matches (outside entity ranges)
  const rawKeywordSpans = findKeywordMatches(streamText, keywordRules)
  const sanitizedKeywordSpans = sanitizeSpansAgainstSeparators(rawKeywordSpans, streamText)
  const keywordSpans: ReplacementSpan[] = []
  for (const kSpan of sanitizedKeywordSpans) {
    const overlapsEntity = occupiedRanges.some(
      (occ) => Math.max(kSpan.start, occ.start) < Math.min(kSpan.end, occ.end)
    )
    if (!overlapsEntity) {
      keywordSpans.push(kSpan)
      occupiedRanges.push({ start: kSpan.start, end: kSpan.end })
    }
  }

  // Step (c): Detect sensitive data (email, phone, CCCD, MST, STK) outside entity and keyword ranges
  const allSensitive = findSensitive(streamText)
  const specificMatches = allSensitive.filter((s) => s.kind !== 'address')
  const specificSpans: ReplacementSpan[] = []

  for (const sMatch of specificMatches) {
    if (!maskKinds[sMatch.kind]) continue
    if (keepValues.includes(sMatch.normalized)) continue

    const overlapsOccupied = occupiedRanges.some(
      (occ) => Math.max(sMatch.start, occ.start) < Math.min(sMatch.end, occ.end)
    )
    if (overlapsOccupied) continue

    const replacementText = maskSensitive(sMatch.kind, sMatch.value, sMatch.normalized)
    specificSpans.push({
      start: sMatch.start,
      end: sMatch.end,
      replacementText,
      type: 'sensitive',
      kind: sMatch.kind,
    })
  }

  const sanitizedSpecificSpans = sanitizeSpansAgainstSeparators(specificSpans, streamText)
  for (const sSpan of sanitizedSpecificSpans) {
    occupiedRanges.push({ start: sSpan.start, end: sSpan.end })
  }

  // Step (d): Address masking outside entity, keyword, and step (c) ranges
  const addressMatches = allSensitive.filter((s) => s.kind === 'address')
  const addressSpans: ReplacementSpan[] = []

  if (maskKinds.address) {
    for (const addrMatch of addressMatches) {
      if (keepValues.includes(addrMatch.normalized)) continue

      const addrStart = addrMatch.start
      let addrEnd = addrMatch.end
      for (let i = addrStart + 1; i < addrEnd; i++) {
        if (isSeparatorChar(streamText[i])) {
          addrEnd = i
          break
        }
      }
      if (addrEnd <= addrStart) continue

      const subRanges = subtractRanges(addrStart, addrEnd, occupiedRanges)

      for (const [subStart, subEnd] of subRanges) {
        const subRaw = streamText.slice(subStart, subEnd)
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
      }
    }
  }

  const allSpans = [
    ...entitySpans,
    ...keywordSpans,
    ...sanitizedSpecificSpans,
    ...addressSpans,
  ]
  if (allSpans.length === 0) return false

  allSpans.sort((a, b) => a.start - b.start)

  return applySpansToNodeRanges(nodeRanges, allSpans, stats, targetFilter)
}

export function replaceParagraphText(
  p: Element,
  opts: {
    customEntities?: CustomEntity[]
    maskKinds?: Partial<Record<SensitiveKind, boolean>>
    keepValues?: string[]
    deletedTextMode?: DeletedTextMode
    keywordRules?: KeywordRule[]
  },
  stats: AnonymizeReplacements
): boolean {
  let paragraphModified = false

  // 1. Regular text stream (w:t) with virtual separators
  const bodyStream = buildParagraphStream(p, 'body')
  if (bodyStream.streamText.length > 0) {
    if (replaceParagraphStream(bodyStream, opts, stats, (range) => !range.isDelText)) {
      paragraphModified = true
    }
  }

  // 2. Track Changes deleted text stream (w:delText)
  const mode = opts.deletedTextMode ?? 'mask'
  if (mode === 'mask') {
    const hasDelText = p.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText').length > 0
    if (hasDelText) {
      // Build original stream with label context from w:t and virtual separators
      const origStream = buildParagraphStream(p, 'original')
      if (origStream.streamText.length > 0) {
        // Apply replacements ONLY to w:delText nodes
        if (replaceParagraphStream(origStream, opts, stats, (range) => range.isDelText)) {
          paragraphModified = true
        }
      }
    }
  } else if (mode === 'remove') {
    // Fallback masking if any delText remains after element removal, but NO keyword rules applied
    const delNodes = getDirectParagraphTNodes(p, 'delText')
    if (delNodes.length > 0) {
      if (replaceNodeListText(delNodes, { ...opts, keywordRules: undefined }, stats)) {
        paragraphModified = true
      }
    }
  }

  return paragraphModified
}

export function replaceTextInXmlDocument(
  doc: Document,
  opts: Pick<AnonymizeOptions, 'customEntities' | 'maskKinds' | 'keepValues' | 'deletedTextMode' | 'keywordRules'>,
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
