import { normalizeString } from './normalize'
import { IdentityMapping, InspectionReport, KnownIdentity } from './types'

export function buildDefaultMapping(report: InspectionReport): IdentityMapping {
  const mapping: IdentityMapping = {}
  report.identities.forEach((ident, index) => {
    const num = index + 1
    mapping[ident.author] = {
      label: `Người góp ý ${num}`,
      initials: `NG${num}`,
    }
  })
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

  for (const [author, { label, initials }] of Object.entries(mapping)) {
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
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
