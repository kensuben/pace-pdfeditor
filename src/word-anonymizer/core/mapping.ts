import { normalizeString } from './normalize'
import { CustomEntity, IdentityMapping, InspectionReport, KeywordRule, KnownIdentity } from './types'

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

export function validateKeywordRules(
  rules: KeywordRule[],
  entities: CustomEntity[] = [],
  mapping: IdentityMapping = {}
): { valid: boolean; errors: Record<string, string>; generalErrors: string[] } {
  const errors: Record<string, string> = {}
  const generalErrors: string[] = []
  const seenFinds = new Map<string, string>()

  const protectedLabels = new Set<string>()
  for (const ent of entities) {
    if (ent.label) protectedLabels.add(normalizeString(ent.label).toLowerCase())
  }
  for (const m of Object.values(mapping)) {
    if (m.label) protectedLabels.add(normalizeString(m.label).toLowerCase())
  }

  for (const rule of rules) {
    const trimmedFind = rule.find.trim()
    const lowerFind = normalizeString(trimmedFind).toLowerCase()

    // 1. find sau trim < 2 ký tự
    if (trimmedFind.length < 2) {
      errors[rule.id] = 'Từ khoá phải có ít nhất 2 ký tự'
      continue
    }

    // 2. trùng find (không phân biệt hoa thường)
    if (seenFinds.has(lowerFind)) {
      errors[rule.id] = 'Từ khoá bị trùng lặp'
      const prevId = seenFinds.get(lowerFind)!
      if (!errors[prevId]) {
        errors[prevId] = 'Từ khoá bị trùng lặp'
      }
      continue
    }
    seenFinds.set(lowerFind, rule.id)

    // 3. replace chứa find của chính rule đó
    if (rule.replace && rule.replace.toLowerCase().includes(lowerFind)) {
      errors[rule.id] = 'Giá trị thay thế không được chứa từ khoá'
      continue
    }

    // 4. find trùng nhãn pháp nhân/người tham gia đang dùng
    if (protectedLabels.has(lowerFind)) {
      errors[rule.id] = 'Từ khoá trùng với nhãn pháp nhân hoặc người tham gia đang dùng'
      continue
    }
  }

  const isValid = Object.keys(errors).length === 0 && generalErrors.length === 0
  return { valid: isValid, errors, generalErrors }
}
