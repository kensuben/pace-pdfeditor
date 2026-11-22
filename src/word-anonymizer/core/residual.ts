import JSZip from 'jszip'
import { OOXML_NAMESPACES } from './constants'
import { foldSearchString } from './normalize'
import { findSensitive, isMaskedValue, normalizePhone } from './sensitive'
import {
  CustomEntity,
  DeletedTextMode,
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
        // Collect text from w:t and w:instrText, and deleted text from w:delText and w:delInstrText
        const tEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't'))
        const instrEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'instrText'))
        const delTextEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delText'))
        const delInstrEls = Array.from(doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'delInstrText'))

        const textChunks: string[] = []
        for (const el of [...tEls, ...instrEls]) {
          const content = el.textContent || ''
          if (content) textChunks.push(content)
        }

        const combinedText = textChunks.join(' ')
        if (combinedText.trim()) {
          const sensitiveMatches = findSensitive(combinedText)
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

        const delChunks: string[] = []
        for (const el of [...delTextEls, ...delInstrEls]) {
          const content = el.textContent || ''
          if (content) delChunks.push(content)
        }

        const combinedDelText = delChunks.join(' ')
        if (combinedDelText.trim()) {
          const sensitiveMatches = findSensitive(combinedDelText)
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
