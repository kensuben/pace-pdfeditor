import JSZip from 'jszip'
import { OOXML_NAMESPACES } from './constants'
import { foldSearchString } from './normalize'
import { findSensitive, isMaskedValue, normalizePhone } from './sensitive'
import { buildParagraphStream, findKeywordMatches } from './textReplace'
import {
  CustomEntity,
  DeletedTextMode,
  KeywordRule,
  KnownIdentity,
  ResidualCategory,
  ResidualFinding,
  ResidualReport,
  SensitiveKind,
} from './types'
import { parseXml } from './xml'

export interface ScanResidualOptions {
  maskKinds?: Partial<Record<SensitiveKind, boolean>>
  keepValues?: string[]
  deletedTextMode?: DeletedTextMode
  keywordRules?: KeywordRule[]
}

export async function scanResidual(
  output: ArrayBuffer,
  identities: KnownIdentity[],
  extraTargets: (string | CustomEntity)[] = [],
  options: ScanResidualOptions = {}
): Promise<ResidualReport> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(output)
  } catch {
    return {
      status: 'FAIL',
      findings: [
        {
          part: 'root',
          matchedString: 'invalid-zip',
          count: 1,
          category: 'metadata',
        },
      ],
    }
  }

  const maskKinds: Record<SensitiveKind, boolean> = {
    email: options.maskKinds?.email ?? true,
    phone: options.maskKinds?.phone ?? true,
    nationalId: options.maskKinds?.nationalId ?? true,
    taxCode: options.maskKinds?.taxCode ?? true,
    bankAccount: options.maskKinds?.bankAccount ?? true,
    address: options.maskKinds?.address ?? true,
  }
  const keepValues = options.keepValues || []

  // 1. Collect target strings from identities and extraTargets
  const rawTargets: string[] = []
  for (const ident of identities) {
    if (ident.author) rawTargets.push(ident.author)
    if (ident.email) rawTargets.push(ident.email)
    if (ident.userId) rawTargets.push(ident.userId)
  }
  for (const extra of extraTargets) {
    if (!extra) continue
    if (typeof extra === 'string') {
      rawTargets.push(extra)
    } else if (typeof extra === 'object' && Array.isArray((extra as CustomEntity).values)) {
      for (const val of (extra as CustomEntity).values) {
        if (typeof val === 'string') {
          rawTargets.push(val)
        }
      }
    }
  }

  // Deduplicate and filter out short strings (<= 2 chars)
  const targetsMap = new Map<string, string>() // folded -> raw
  for (const raw of rawTargets) {
    const trimmed = raw.trim()
    if (trimmed.length <= 2) continue

    const folded = foldSearchString(trimmed)
    if (folded.length <= 2) continue

    if (!targetsMap.has(folded)) {
      targetsMap.set(folded, trimmed)
    }
  }

  const findings: ResidualFinding[] = []
  const filePaths = Object.keys(zip.files).sort()

  // 2. Search for explicit targets (identities & custom entities)
  for (const path of filePaths) {
    if (!path.endsWith('.xml') && !path.endsWith('.rels')) continue
    const file = zip.file(path)
    if (!file) continue

    const text = await file.async('string')
    const foldedFile = foldSearchString(text)

    for (const [foldedTarget, rawTarget] of targetsMap.entries()) {
      const count = countOccurrences(foldedFile, foldedTarget)
      if (count === 0) continue

      const category = determineCategory(path, text, foldedTarget)
      findings.push({
        part: path,
        matchedString: rawTarget,
        count,
        category,
      })
    }
  }

  // 3. Independent scan: run findSensitive on output text (document, headers, footers, comments, etc.) and .rels Target
  for (const path of filePaths) {
    const file = zip.file(path)
    if (!file) continue

    if (path.endsWith('.rels')) {
      const xmlText = await file.async('string')
      try {
        const doc = parseXml(xmlText)
        const rels = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.rels, 'Relationship'))
        for (const rel of rels) {
          const target = rel.getAttribute('Target') || ''
          if (target.toLowerCase().startsWith('mailto:')) {
            const email = target.slice('mailto:'.length).trim()
            if (
              email &&
              maskKinds.email &&
              !keepValues.includes(email.toLowerCase()) &&
              !isMaskedValue('email', email)
            ) {
              findings.push({
                part: path,
                matchedString: email,
                count: 1,
                category: 'metadata',
              })
            }
          } else if (target.toLowerCase().startsWith('tel:')) {
            const phone = target.slice('tel:'.length).trim()
            const norm = normalizePhone(phone) || phone
            if (
              phone &&
              maskKinds.phone &&
              !keepValues.includes(norm) &&
              !isMaskedValue('phone', phone)
            ) {
              findings.push({
                part: path,
                matchedString: phone,
                count: 1,
                category: 'metadata',
              })
            }
          }
        }
      } catch {
        // Ignore XML parse errors for corrupted rels
      }
    } else if (path.startsWith('word/') && path.endsWith('.xml') && path !== 'word/people.xml') {
      const xmlText = await file.async('string')
      try {
        const doc = parseXml(xmlText)
        const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

        for (const p of paragraphs) {
          // 1. Regular stream (w:t) with virtual separators
          const bodyStream = buildParagraphStream(p, 'body')
          if (bodyStream.streamText.trim()) {
            const sensitiveMatches = findSensitive(bodyStream.streamText)
            for (const sMatch of sensitiveMatches) {
              if (!maskKinds[sMatch.kind]) continue
              if (keepValues.includes(sMatch.normalized)) continue
              if (isMaskedValue(sMatch.kind, sMatch.value)) continue

              findings.push({
                part: path,
                matchedString: sMatch.value,
                count: 1,
                category: path === 'word/comments.xml' ? 'comment-text' : 'body-text',
              })
            }
          }

          // 2. Deleted text stream (w:delText) with original stream context
          const hasDel = p.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText').length > 0
          if (hasDel) {
            const origStream = buildParagraphStream(p, 'original')
            if (origStream.streamText.trim()) {
              const sensitiveMatches = findSensitive(origStream.streamText)
              for (const sMatch of sensitiveMatches) {
                if (!maskKinds[sMatch.kind]) continue
                if (keepValues.includes(sMatch.normalized)) continue

                // Only report finding if this sensitive match overlaps with w:delText
                const overlapsDel = origStream.nodeRanges.some(
                  (r) => r.isDelText && Math.max(sMatch.start, r.start) < Math.min(sMatch.end, r.end)
                )
                if (!overlapsDel) continue

                if (isMaskedValue(sMatch.kind, sMatch.value)) continue

                findings.push({
                  part: path,
                  matchedString: sMatch.value,
                  count: 1,
                  category: 'deleted-text',
                })
              }
            }
          }
        }

        // Field codes
        const instrEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'instrText'))
        for (const el of instrEls) {
          const content = el.textContent || ''
          if (content.trim()) {
            const sensitiveMatches = findSensitive(content)
            for (const sMatch of sensitiveMatches) {
              if (!maskKinds[sMatch.kind]) continue
              if (keepValues.includes(sMatch.normalized)) continue
              if (isMaskedValue(sMatch.kind, sMatch.value)) continue

              findings.push({
                part: path,
                matchedString: sMatch.value,
                count: 1,
                category: path === 'word/comments.xml' ? 'comment-text' : 'body-text',
              })
            }
          }
        }

        const delInstrEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delInstrText'))
        for (const el of delInstrEls) {
          const content = el.textContent || ''
          if (content.trim()) {
            const sensitiveMatches = findSensitive(content)
            for (const sMatch of sensitiveMatches) {
              if (!maskKinds[sMatch.kind]) continue
              if (keepValues.includes(sMatch.normalized)) continue
              if (isMaskedValue(sMatch.kind, sMatch.value)) continue

              findings.push({
                part: path,
                matchedString: sMatch.value,
                count: 1,
                category: 'deleted-text',
              })
            }
          }
        }
      } catch {
        // Ignore XML parse errors
      }
    } else if (path.startsWith('docProps/') && path.endsWith('.xml')) {
      const xmlText = await file.async('string')
      try {
        const doc = parseXml(xmlText)
        const allText = doc.documentElement?.textContent || ''
        if (allText.trim()) {
          const sensitiveMatches = findSensitive(allText)
          for (const sMatch of sensitiveMatches) {
            if (!maskKinds[sMatch.kind]) continue
            if (keepValues.includes(sMatch.normalized)) continue
            if (isMaskedValue(sMatch.kind, sMatch.value)) continue

            findings.push({
              part: path,
              matchedString: sMatch.value,
              count: 1,
              category: 'metadata',
            })
          }
        }
      } catch {
        // Ignore parse error
      }
    }
  }

  // 4. Scan for residual keywords (findKeywordMatches on output parts)
  const keywordRules = options.keywordRules || []
  if (keywordRules.length > 0) {
    const otherReplacements = keywordRules
      .map((r) => ({ id: r.id, replace: r.replace ? r.replace.trim() : '****' }))
      .filter((r) => r.replace.length > 0)

    for (const path of filePaths) {
      const file = zip.file(path)
      if (!file) continue

      if (path.startsWith('word/') && path.endsWith('.xml') && path !== 'word/people.xml') {
        const xmlText = await file.async('string')
        try {
          const doc = parseXml(xmlText)
          const paragraphs = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'p'))

          for (const p of paragraphs) {
            // Check regular text (w:t) with virtual separators
            const bodyStream = buildParagraphStream(p, 'body')
            if (bodyStream.streamText) {
              const kwMatches = findKeywordMatches(bodyStream.streamText, keywordRules)
              for (const match of kwMatches) {
                const isInsideOtherReplace = otherReplacements.some((rep) => {
                  if (rep.id === match.ruleId) return false
                  let searchPos = 0
                  while ((searchPos = bodyStream.streamText.indexOf(rep.replace, searchPos)) !== -1) {
                    const repEnd = searchPos + rep.replace.length
                    if (match.start >= searchPos && match.end <= repEnd) return true
                    searchPos = repEnd
                  }
                  return false
                })

                if (!isInsideOtherReplace) {
                  findings.push({
                    part: path,
                    matchedString: match.matchedText || bodyStream.streamText.slice(match.start, match.end),
                    count: 1,
                    category: path === 'word/comments.xml' ? 'comment-text' : 'body-text',
                  })
                }
              }
            }

            // Check deleted text (w:delText) with original stream context
            const hasDel = p.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText').length > 0
            if (hasDel) {
              const origStream = buildParagraphStream(p, 'original')
              if (origStream.streamText) {
                const kwMatches = findKeywordMatches(origStream.streamText, keywordRules)
                for (const match of kwMatches) {
                  const overlapsDel = origStream.nodeRanges.some(
                    (r) => r.isDelText && Math.max(match.start, r.start) < Math.min(match.end, r.end)
                  )
                  if (!overlapsDel) continue

                  const isInsideOtherReplace = otherReplacements.some((rep) => {
                    if (rep.id === match.ruleId) return false
                    let searchPos = 0
                    while ((searchPos = origStream.streamText.indexOf(rep.replace, searchPos)) !== -1) {
                      const repEnd = searchPos + rep.replace.length
                      if (match.start >= searchPos && match.end <= repEnd) return true
                      searchPos = repEnd
                    }
                    return false
                  })

                  if (!isInsideOtherReplace) {
                    findings.push({
                      part: path,
                      matchedString: match.matchedText || origStream.streamText.slice(match.start, match.end),
                      count: 1,
                      category: 'deleted-text',
                    })
                  }
                }
              }
            }
          }

          // Check field codes
          const instrEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'instrText'))
          for (const el of instrEls) {
            const instr = el.textContent || ''
            if (instr) {
              const kwMatches = findKeywordMatches(instr, keywordRules)
              for (const match of kwMatches) {
                const isInsideOtherReplace = otherReplacements.some((rep) => {
                  if (rep.id === match.ruleId) return false
                  let searchPos = 0
                  while ((searchPos = instr.indexOf(rep.replace, searchPos)) !== -1) {
                    const repEnd = searchPos + rep.replace.length
                    if (match.start >= searchPos && match.end <= repEnd) return true
                    searchPos = repEnd
                  }
                  return false
                })
                if (!isInsideOtherReplace) {
                  findings.push({
                    part: path,
                    matchedString: match.matchedText || instr.slice(match.start, match.end),
                    count: 1,
                    category: path === 'word/comments.xml' ? 'comment-text' : 'body-text',
                  })
                }
              }
            }
          }

          const delInstrEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delInstrText'))
          for (const el of delInstrEls) {
            const instr = el.textContent || ''
            if (instr) {
              const kwMatches = findKeywordMatches(instr, keywordRules)
              for (const match of kwMatches) {
                const isInsideOtherReplace = otherReplacements.some((rep) => {
                  if (rep.id === match.ruleId) return false
                  let searchPos = 0
                  while ((searchPos = instr.indexOf(rep.replace, searchPos)) !== -1) {
                    const repEnd = searchPos + rep.replace.length
                    if (match.start >= searchPos && match.end <= repEnd) return true
                    searchPos = repEnd
                  }
                  return false
                })
                if (!isInsideOtherReplace) {
                  findings.push({
                    part: path,
                    matchedString: match.matchedText || instr.slice(match.start, match.end),
                    count: 1,
                    category: 'deleted-text',
                  })
                }
              }
            }
          }
        } catch {
          // Ignore XML parse errors
        }
      } else if (path.startsWith('docProps/') && path.endsWith('.xml')) {
        const xmlText = await file.async('string')
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
            if (text) {
              const kwMatches = findKeywordMatches(text, keywordRules)
              for (const match of kwMatches) {
                const isInsideOtherReplace = otherReplacements.some((rep) => {
                  if (rep.id === match.ruleId) return false
                  let searchPos = 0
                  while ((searchPos = text.indexOf(rep.replace, searchPos)) !== -1) {
                    const repEnd = searchPos + rep.replace.length
                    if (match.start >= searchPos && match.end <= repEnd) return true
                    searchPos = repEnd
                  }
                  return false
                })

                if (!isInsideOtherReplace) {
                  findings.push({
                    part: path,
                    matchedString: match.matchedText || text.slice(match.start, match.end),
                    count: 1,
                    category: 'metadata',
                  })
                }
              }
            }
          }
        } catch {
          // Ignore XML parse errors
        }
      }
    }
  }

  // Deduplicate findings with identical part, matchedString, and category
  const uniqueFindings: ResidualFinding[] = []
  const seen = new Set<string>()
  for (const f of findings) {
    const key = `${f.part}|${f.matchedString}|${f.category}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueFindings.push(f)
    }
  }

  const deletedTextMode = options.deletedTextMode ?? 'mask'

  let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS'
  const significantFindings =
    deletedTextMode === 'keep'
      ? uniqueFindings.filter((f) => f.category !== 'deleted-text')
      : uniqueFindings

  if (significantFindings.length > 0) {
    const hasMetadata = significantFindings.some((f) => f.category === 'metadata')
    status = hasMetadata ? 'FAIL' : 'WARN'
  }

  return {
    status,
    findings: uniqueFindings,
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}

function determineCategory(
  path: string,
  rawXml: string,
  foldedTarget: string
): ResidualCategory {
  if (
    path.startsWith('docProps/') ||
    path.endsWith('.rels') ||
    path === 'word/people.xml'
  ) {
    return 'metadata'
  }

  try {
    const doc = parseXml(rawXml)
    const tEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
    const delTextEls = Array.from(
      doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText')
    )
    const delInstrEls = Array.from(
      doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delInstrText')
    )
    const instrEls = Array.from(
      doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'instrText')
    )

    let tAndInstrText = ''
    for (const el of [...tEls, ...instrEls]) {
      tAndInstrText += ' ' + (el.textContent || '')
    }

    let delTextCombined = ''
    for (const el of [...delTextEls, ...delInstrEls]) {
      delTextCombined += ' ' + (el.textContent || '')
    }

    // Clear all text elements to see if target appears in XML structure/attributes
    for (const el of [...tEls, ...delTextEls, ...delInstrEls, ...instrEls]) {
      el.textContent = ''
    }

    const foldedWithoutText = foldSearchString(
      new XMLSerializer().serializeToString(doc)
    )
    if (foldedWithoutText.includes(foldedTarget)) {
      return 'metadata'
    }

    const foldedTAndInstr = foldSearchString(tAndInstrText)
    if (foldedTAndInstr.includes(foldedTarget)) {
      return path === 'word/comments.xml' ? 'comment-text' : 'body-text'
    }

    const foldedDelText = foldSearchString(delTextCombined)
    if (foldedDelText.includes(foldedTarget)) {
      return 'deleted-text'
    }
  } catch {
    return 'metadata'
  }

  return 'metadata'
}
