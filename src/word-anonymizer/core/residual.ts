import JSZip from 'jszip'
import { OOXML_NAMESPACES } from './constants'
import { foldSearchString } from './normalize'
import {
  KnownIdentity,
  ResidualCategory,
  ResidualFinding,
  ResidualReport,
} from './types'
import { parseXml } from './xml'

export async function scanResidual(
  output: ArrayBuffer,
  identities: KnownIdentity[],
  extraTargets: string[] = []
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

  // Collect target strings to search
  const rawTargets: string[] = []
  for (const ident of identities) {
    if (ident.author) rawTargets.push(ident.author)
    if (ident.email) rawTargets.push(ident.email)
    if (ident.userId) rawTargets.push(ident.userId)
  }
  for (const extra of extraTargets) {
    if (extra) rawTargets.push(extra)
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

  let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS'
  if (findings.length > 0) {
    const hasMetadata = findings.some((f) => f.category === 'metadata')
    status = hasMetadata ? 'FAIL' : 'WARN'
  }

  return {
    status,
    findings,
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
    const instrEls = Array.from(
      doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 'instrText')
    )

    let tAndInstrText = ''
    for (const el of [...tEls, ...instrEls]) {
      tAndInstrText += ' ' + (el.textContent || '')
    }

    let delTextCombined = ''
    for (const el of delTextEls) {
      delTextCombined += ' ' + (el.textContent || '')
    }

    // Clear all text elements to see if target appears in XML structure/attributes
    for (const el of [...tEls, ...delTextEls, ...instrEls]) {
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
