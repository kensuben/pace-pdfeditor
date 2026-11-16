import { normalizeString } from './normalize'
import { IdentityMapping, InspectionReport, KnownIdentity } from './types'

export function buildDefaultMapping(report: InspectionReport): IdentityMapping {
  const mapping: IdentityMapping = {}
  let contributorCount = 0
  let mentionedCount = 0

  for (const ident of report.identities) {
    if (ident.kind === 'mentioned') {
      mentionedCount++
      mapping[ident.author] = {
        label: `Người được nhắc ${mentionedCount}`,
        initials: `NN${mentionedCount}`,
        alias: `nguoi-duoc-nhac-${mentionedCount}`,
      }
    } else {
      contributorCount++
      mapping[ident.author] = {
        label: `Người góp ý ${contributorCount}`,
        initials: `NG${contributorCount}`,
        alias: `nguoi-gop-y-${contributorCount}`,
      }
    }
  }

  return mapping
}

export function validateMapping(
  mapping: IdentityMapping,
  knownIdentities: KnownIdentity[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const usedLabels = new Set<string>()

  const realNames = new Set<string>()
  for (const ident of knownIdentities) {
    if (ident.author) realNames.add(normalizeString(ident.author).toLowerCase())
    if (ident.email) realNames.add(ident.email.toLowerCase())
    if (ident.userId) realNames.add(ident.userId.toLowerCase())
  }

  for (const [author, { label, initials, alias }] of Object.entries(mapping)) {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) {
      errors.push(`Nhãn cho tác giả '${author}' không được để trống.`)
      continue
    }

    const lowerLabel = trimmedLabel.toLowerCase()
    if (usedLabels.has(lowerLabel)) {
      errors.push(`Nhãn '${trimmedLabel}' bị trùng lặp cho nhiều người góp ý.`)
    }
    usedLabels.add(lowerLabel)

    if (realNames.has(lowerLabel)) {
      errors.push(`Nhãn '${trimmedLabel}' trùng với tên thật hoặc danh tính trong tài liệu.`)
    }

    if (!initials.trim()) {
      errors.push(`Tên viết tắt cho tác giả '${author}' không được để trống.`)
    }

    if (!alias || !alias.trim()) {
      errors.push(`Alias cho tác giả '${author}' không được để trống.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
