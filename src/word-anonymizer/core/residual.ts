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
  identities: KnownIdentity[]
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
    const textEls = Array.from(
      doc.getElementsByTagNameNS(OOXML_NAMESPACES.w, 't')
    )

    let allTextCombined = ''
    for (const el of textEls) {
      allTextCombined += ' ' + (el.textContent || '')
      // Empty textContent to test remaining attributes/metadata
      el.textContent = ''
    }

    const foldedWithoutText = foldSearchString(
      new XMLSerializer().serializeToString(doc)
    )
    if (foldedWithoutText.includes(foldedTarget)) {
      return 'metadata'
    }

    const foldedOnlyText = foldSearchString(allTextCombined)
    if (foldedOnlyText.includes(foldedTarget)) {
      return path === 'word/comments.xml' ? 'comment-text' : 'body-text'
    }
  } catch {
    // If parsing fails for any reason, default to metadata for safety
    return 'metadata'
  }

  return 'metadata'
}
