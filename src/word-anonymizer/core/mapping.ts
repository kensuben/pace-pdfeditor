import { normalizeString } from './normalize'
import { CustomEntity, IdentityMapping, InspectionReport, KnownIdentity } from './types'

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

export function validateEntities(
  entities: CustomEntity[],
  mapping?: IdentityMapping,
  identities?: KnownIdentity[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const usedLabels = new Set<string>()

  const participantLabels = new Set<string>()
  if (mapping) {
    for (const m of Object.values(mapping)) {
      if (m.label) {
        participantLabels.add(normalizeString(m.label).toLowerCase())
      }
    }
  }
  if (identities) {
    for (const ident of identities) {
      if (ident.author) {
        participantLabels.add(normalizeString(ident.author).toLowerCase())
      }
    }
  }

  const seenValues = new Map<string, string>() // normalizedValue -> entity.id

  for (const entity of entities) {
    const trimmedLabel = entity.label.trim()
    if (!trimmedLabel) {
      errors.push('Nhãn thực thể không được để trống.')
      continue
    }

    const lowerLabel = trimmedLabel.toLowerCase()
    if (usedLabels.has(lowerLabel)) {
      errors.push(`Nhãn '${trimmedLabel}' bị trùng lặp.`)
    }
    usedLabels.add(lowerLabel)

    if (participantLabels.has(lowerLabel)) {
      errors.push(`Nhãn '${trimmedLabel}' trùng với nhãn người tham gia.`)
    }

    for (const val of entity.values) {
      const trimmedVal = val.trim()
      if (trimmedVal.length < 2) {
        errors.push(`Giá trị '${val}' của '${trimmedLabel}' phải có ít nhất 2 ký tự.`)
        continue
      }

      const normVal = normalizeString(trimmedVal).toLowerCase()
      const existingOwnerId = seenValues.get(normVal)
      if (existingOwnerId && existingOwnerId !== entity.id) {
        errors.push(
          `Giá trị '${trimmedVal}' xuất hiện ở cả hai thực thể khác nhau.`
        )
      } else {
        seenValues.set(normVal, entity.id)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
