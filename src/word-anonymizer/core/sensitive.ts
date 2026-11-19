import { foldSearchString } from './normalize'
import { SensitiveKind } from './types'

export interface SensitiveMatch {
  kind: SensitiveKind
  value: string
  normalized: string
  start: number
  end: number
}

// TODO(verify): Mẫu email không lặp lùi: kết thúc nhãn đuôi với ranh giới ký tự chữ/số.
const EMAIL_REGEX =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?![a-zA-Z0-9])/g

// TODO(verify): Mẫu ứng viên số: regex đơn giản [+\d(][\d ().-]{4,24}\d không lookaround, kiểm tra ranh giới hoàn toàn bằng JS.
const NUMBER_CANDIDATE_REGEX = /[+\d(][\d ().-]{4,24}\d/g

// TODO(verify): Mẫu CCCD/CMND: 9 hoặc 12 chữ số, có từ khoá trong phạm vi 40 ký tự phía trước.
const NATIONAL_ID_KEYWORDS = [
  'cccd',
  'cmnd',
  'can cuoc',
  'chung minh',
  'so dinh danh',
  'id card',
]

// TODO(verify): Mẫu MST: 10 chữ số hoặc 10 chữ số + '-' + 3 chữ số, có từ khoá trong phạm vi 40 ký tự phía trước.
const TAX_CODE_KEYWORDS = [
  'mst',
  'ma so thue',
  'ma so doanh nghiep',
  'tax code',
]

// TODO(verify): Mẫu STK: 6-19 chữ số, có thể chia nhóm, có từ khoá trong phạm vi 40 ký tự phía trước.
const BANK_ACCOUNT_KEYWORDS = [
  'stk',
  'so tai khoan',
  'tai khoan so',
  'account no',
  'account number',
]

// TODO(verify): Nhãn địa chỉ: Địa chỉ, Trụ sở, Địa chỉ trụ sở, Địa chỉ thường trú, Nơi cư trú, Address kèm dấu ':'.
const ADDRESS_LABEL_REGEX =
  /(?<![\p{L}\p{N}])(?:Địa chỉ trụ sở|Địa chỉ thường trú|Địa chỉ|Trụ sở|Nơi cư trú|Address)\s*:\s*/giu

function hasKeywordBefore(
  text: string,
  start: number,
  keywords: string[]
): boolean {
  const windowStart = Math.max(0, start - 40)
  if (windowStart >= start) return false
  let windowText = text.slice(windowStart, start)

  // Fast check: if window has no letters, it cannot contain any keywords
  if (!/[a-zA-Z\u00C0-\u1EF9]/.test(windowText)) {
    return false
  }

  // Do not search across previous sentence or semicolon boundaries
  const lastSep = Math.max(
    windowText.lastIndexOf('. '),
    windowText.lastIndexOf('; '),
    windowText.lastIndexOf('\n')
  )
  if (lastSep !== -1) {
    windowText = windowText.slice(lastSep + 2)
  }

  const folded = foldSearchString(windowText)

  for (const kw of keywords) {
    const foldedKw = foldSearchString(kw)
    let idx = 0
    while ((idx = folded.indexOf(foldedKw, idx)) !== -1) {
      const before = idx > 0 ? folded[idx - 1] : ' '
      const after =
        idx + foldedKw.length < folded.length
          ? folded[idx + foldedKw.length]
          : ' '
      const isWordChar = (c: string) => /[a-z0-9]/.test(c)
      if (!isWordChar(before) && !isWordChar(after)) {
        return true
      }
      idx += foldedKw.length
    }
  }
  return false
}

export function maskEmail(value: string): string {
  const atIndex = value.indexOf('@')
  if (atIndex <= 0) return value

  const localPart = value.slice(0, atIndex)
  const domainPart = value.slice(atIndex + 1)

  const maskedLocal = `${localPart[0]}****`

  const twoPartMatch = domainPart.match(/\.(?:com|edu|gov|org|net)\.[a-zA-Z]{2}$/i)
  const ext = twoPartMatch
    ? twoPartMatch[0]
    : domainPart.slice(domainPart.lastIndexOf('.'))
  const name = domainPart.slice(0, domainPart.length - ext.length)
  const firstDomainChar = name[0] || 'e'
  const maskedDomain = `${firstDomainChar}****${ext}`

  return `${maskedLocal}@${maskedDomain}`
}

export function normalizePhone(raw: string): string | null {
  // Reject multiple consecutive separators like '..' or '--' or '  '
  if (/[\s.-]{2,}/.test(raw)) return null

  // Reject money patterns like 1.000.000.000
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return null

  // Reject date patterns like 19.11.2026
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(raw)) return null

  const digits = raw.replace(/\D/g, '')
  let normalized = digits
  if (normalized.startsWith('84')) {
    normalized = '0' + normalized.slice(2)
  }

  // Mobile: 0 + [35789] + 8 digits = 10 digits
  if (
    normalized.length === 10 &&
    normalized.startsWith('0') &&
    /[35789]/.test(normalized[1])
  ) {
    return normalized
  }
  // Fixed line: 0 + 2 + 9 digits = 11 digits
  if (normalized.length === 11 && normalized.startsWith('02')) {
    return normalized
  }

  return null
}

export function maskPhone(normalizedDigits: string): string {
  const middle = '*'.repeat(normalizedDigits.length - 4)
  return `${normalizedDigits.slice(0, 2)}${middle}${normalizedDigits.slice(-2)}`
}

export function maskNationalId(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 3) return '*'.repeat(digits.length)
  const maskedPrefix = '*'.repeat(digits.length - 3)
  return `${maskedPrefix}${digits.slice(-3)}`
}

export function maskTaxCode(value: string): string {
  const trimmed = value.trim()
  if (trimmed.includes('-')) {
    const [mainPart, branch] = trimmed.split('-')
    const cleanMain = mainPart.replace(/\D/g, '')
    const maskedMain = `*******${cleanMain.slice(-3)}`
    return `${maskedMain}-${branch.trim()}`
  }
  const clean = trimmed.replace(/\D/g, '')
  return `*******${clean.slice(-3)}`
}

export function maskBankAccount(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 4) return '*'.repeat(digits.length)
  const maskedPrefix = '*'.repeat(digits.length - 4)
  return `${maskedPrefix}${digits.slice(-4)}`
}

export function maskAddress(value: string): string {
  const parts = value.split(',')
  if (parts.length <= 1) {
    return '****'
  }
  const maskedParts = parts.slice(0, -1).map(() => '****')
  const lastPart = parts[parts.length - 1]
  return `${maskedParts.join(', ')},${lastPart}`
}

export function maskSensitive(
  kind: SensitiveKind,
  value: string,
  normalized: string
): string {
  switch (kind) {
    case 'email':
      return maskEmail(value)
    case 'phone':
      return maskPhone(normalized)
    case 'nationalId':
      return maskNationalId(value)
    case 'taxCode':
      return maskTaxCode(value)
    case 'bankAccount':
      return maskBankAccount(value)
    case 'address':
      return maskAddress(value)
  }
}

export function findSensitive(text: string): SensitiveMatch[] {
  const candidates: SensitiveMatch[] = []
  let match: RegExpExecArray | null

  // 1. Email (only scan if text contains '@')
  if (text.includes('@')) {
    const emailRegex = new RegExp(EMAIL_REGEX.source, EMAIL_REGEX.flags)
    while ((match = emailRegex.exec(text)) !== null) {
      const raw = match[0]
      if (raw.toLowerCase().endsWith('@anonymized.invalid')) {
        continue
      }
      candidates.push({
        kind: 'email',
        value: raw,
        normalized: raw.trim().toLowerCase(),
        start: match.index,
        end: match.index + raw.length,
      })
    }
  }

  // 2. Address (only scan if text contains ':')
  if (text.includes(':')) {
    const addressRegex = new RegExp(ADDRESS_LABEL_REGEX.source, ADDRESS_LABEL_REGEX.flags)
    while ((match = addressRegex.exec(text)) !== null) {
      const labelEnd = match.index + match[0].length
      const rest = text.slice(labelEnd)
      const newlineIndex = rest.search(/[\r\n]/)
      const addressRaw = newlineIndex >= 0 ? rest.slice(0, newlineIndex) : rest
      const trimmedAddress = addressRaw.trim()
      if (trimmedAddress.length > 0) {
        const leadingSpace = addressRaw.length - addressRaw.trimStart().length
        const start = labelEnd + leadingSpace
        const end = start + trimmedAddress.length
        candidates.push({
          kind: 'address',
          value: trimmedAddress,
          normalized: trimmedAddress.normalize('NFC'),
          start,
          end,
        })
      }
    }
  }

  // 3. Numbers: Tax Code, National ID, Bank Account, Phone
  const numRegex = new RegExp(NUMBER_CANDIDATE_REGEX.source, NUMBER_CANDIDATE_REGEX.flags)
  while ((match = numRegex.exec(text)) !== null) {
    let raw = match[0]
    const matchStart = match.index
    let end = matchStart + raw.length

    // Strip trailing punctuation like sentence-ending period or comma
    const trailingPunct = raw.match(/[.,;:!-]+$/)
    if (trailingPunct) {
      raw = raw.slice(0, raw.length - trailingPunct[0].length)
      end = matchStart + raw.length
    }

    const start = matchStart

    // Boundary check in JS code (zero regex backtracking)
    const charBefore = start > 0 ? text[start - 1] : undefined
    if (charBefore && /[\p{L}\p{N}]/u.test(charBefore)) {
      continue
    }
    const charAfter = end < text.length ? text[end] : undefined
    if (charAfter && /[\p{L}\p{N}]/u.test(charAfter)) {
      while (end < text.length && /[\p{L}\p{N}]/u.test(text[end])) {
        end++
      }
      numRegex.lastIndex = end
      continue
    }

    if (raw.length > 25) continue
    const cleanDigits = raw.replace(/\D/g, '')

    // Check Tax Code
    const taxMatch = raw.match(/^(\d{10})(?:-(\d{3}))?$/)
    if (taxMatch) {
      if (hasKeywordBefore(text, start, TAX_CODE_KEYWORDS)) {
        candidates.push({
          kind: 'taxCode',
          value: raw,
          normalized: raw.trim(),
          start,
          end,
        })
        continue
      }
    }

    // Check National ID (9 or 12 digits, no dots in number)
    if ((cleanDigits.length === 9 || cleanDigits.length === 12) && !raw.includes('.')) {
      if (hasKeywordBefore(text, start, NATIONAL_ID_KEYWORDS)) {
        candidates.push({
          kind: 'nationalId',
          value: raw,
          normalized: cleanDigits,
          start,
          end,
        })
        continue
      }
    }

    // Check Bank Account (6-19 digits)
    if (cleanDigits.length >= 6 && cleanDigits.length <= 19) {
      if (
        !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(raw) &&
        !/^\d{1,3}(\.\d{3})+$/.test(raw)
      ) {
        if (hasKeywordBefore(text, start, BANK_ACCOUNT_KEYWORDS)) {
          candidates.push({
            kind: 'bankAccount',
            value: raw,
            normalized: cleanDigits,
            start,
            end,
          })
          continue
        }
      }
    }

    // Check Phone
    const normalizedPhone = normalizePhone(raw)
    if (normalizedPhone) {
      candidates.push({
        kind: 'phone',
        value: raw,
        normalized: normalizedPhone,
        start,
        end,
      })
    }
  }

  // Priority order:
  // 1. address, email
  // 2. nationalId
  // 3. taxCode
  // 4. bankAccount
  // 5. phone
  const kindPriority: Record<SensitiveKind, number> = {
    address: 1,
    email: 1,
    nationalId: 2,
    taxCode: 3,
    bankAccount: 4,
    phone: 5,
  }

  candidates.sort((a, b) => {
    const prioDiff = kindPriority[a.kind] - kindPriority[b.kind]
    if (prioDiff !== 0) return prioDiff
    const lenDiff = b.end - b.start - (a.end - a.start)
    if (lenDiff !== 0) return lenDiff
    return a.start - b.start
  })

  const selected: SensitiveMatch[] = []
  for (const cand of candidates) {
    const overlaps = selected.some(
      (s) => Math.max(cand.start, s.start) < Math.min(cand.end, s.end)
    )
    if (!overlaps) {
      selected.push(cand)
    }
  }

  selected.sort((a, b) => a.start - b.start)
  return selected
}
