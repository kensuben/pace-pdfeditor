import { foldSearchString } from './normalize'
import { SensitiveKind } from './types'

export interface SensitiveMatch {
  kind: SensitiveKind
  value: string
  normalized: string
  start: number
  end: number
}

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

// TODO(verify): Pre-check nhanh cho địa chỉ: có chữ "địa chỉ"/"trụ sở"/"trú tại" hoặc nhãn cũ, có và không dấu
const ADDRESS_PRECHECK_REGEX =
  /(?:địa\s*chỉ|dia\s*chi|trụ\s*sở|tru\s*so|trú\s*tại|tru\s*tai|văn\s*phòng|van\s*phong|address)/iu

// TODO(verify): Nhãn mở đầu địa chỉ viết liền và có dấu hai chấm; "địa chỉ là" chỉ nhận khi đứng trước số hoặc từ định danh vị trí (Số, Tòa, Lô, Thôn, Ấp, Tầng, Phòng)
const ADDRESS_LABEL_REGEX =
  /(?<![\p{L}\p{N}])(?:(?:có\s+địa\s+chỉ\s+tại|co\s+dia\s+chi\s+tai|địa\s+chỉ\s+trụ\s+sở\s+tại|dia\s+chi\s+tru\s+so\s+tai|địa\s+chỉ\s+tại|dia\s+chi\s+tai|có\s+trụ\s+sở\s+tại|co\s+tru\s+so\s+tai|trụ\s+sở\s+chính\s+tại|tru\s+so\s+chinh\s+tai|trụ\s+sở\s+tại|tru\s+so\s+tai|thường\s+trú\s+tại|thuong\s+tru\s+tai|cư\s+trú\s+tại|cu\s+tru\s+tai)(?::\s*|\s+)|(?:địa\s+chỉ\s+là|dia\s+chi\s+la)(?::\s*|\s+)(?=\d|(?:Số|so|Tòa|toa|Lô|lo|Thôn|thon|Ấp|ap|Tầng|tang|Phòng|phong)(?![\p{L}\p{N}]))|(?:Địa\s*chỉ\s*trụ\s*sở|Dia\s*chi\s*tru\s*so|Địa\s*chỉ\s*liên\s*hệ|Dia\s*chi\s*lien\s*he|Địa\s*chỉ\s*giao\s*dịch|Dia\s*chi\s*giao\s*dich|Địa\s*chỉ\s*thường\s*trú|Dia\s*chi\s*thuong\s*tru|Địa\s*chỉ|Dia\s*chi|Trụ\s*sở\s*chính|Tru\s*so\s*chinh|Trụ\s*sở|Tru\s*so|Văn\s*phòng|Van\s*phong|Nơi\s*cư\s*trú|Noi\s*cu\s*tru|Address)\s*:\s*)/giu

// TODO(verify): Nhãn dừng địa chỉ: các nhãn trường thông tin tiếp theo trong hợp đồng/văn bản.
const ADDRESS_STOP_LABEL_REGEX =
  /(?<![\p{L}\p{N}])(?:Điện\s*thoại|Dien\s*thoai|ĐT|DT|Tel|Fax|Email|E-mail|Website|Người\s*đại\s*diện|Nguoi\s*dai\s*dien|Đại\s*diện|Dai\s*dien|Chức\s*vụ|Chuc\s*vu|Mã\s*số\s*thuế|Ma\s*so\s*thue|MST|Số\s*tài\s*khoản|So\s*tai\s*khoan|STK|CCCD|CMND)(?![\p{L}\p{N}])/iu

// TODO(verify): Điểm dừng bổ sung cho dạng viết liền: các cụm phẩy + nhãn trường tiếp theo
const INLINE_COMMA_STOP_REGEX =
  /,\s*(?:do\s+|(?:người\s*đại\s*diện|nguoi\s*dai\s*dien|đại\s*diện|dai\s*dien|mã\s*số\s*thuế|ma\s*so\s*thue|mst|điện\s*thoại|dien\s*thoai|đt|dt|e-?mail)(?![\p{L}\p{N}]))/iu

// TODO(verify): Điểm dừng bổ sung cho dạng viết liền: dấu chấm theo sau là khoảng trắng và chữ in hoa thật (chỉ dùng cờ u, không dùng cờ i để tránh khớp nhầm chữ thường)
const INLINE_DOT_STOP_REGEX =
  /(?<!\b(?:TP|Tp|tp|Q|q|P|p|TX|Tx|tx|TT|Tt|tt|H|h|X|x|T|t|KDC|Kdc|kdc|KCN|Kcn|kcn|BT|Bt|bt|No|no|Str|str|St|st|Rd|rd|Ave|ave|Bldg|bldg|Apt|apt|Fl|fl))\.\s+[\p{Lu}]/u

function isWordChar(text: string, pos: number): boolean {
  const code = text.charCodeAt(pos)
  if (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  ) {
    return true
  }
  if (code > 127) {
    return /[\p{L}\p{N}]/u.test(text[pos])
  }
  return false
}

function hasKeywordBefore(
  text: string,
  start: number,
  keywords: string[]
): boolean {
  const windowStart = Math.max(0, start - 40)
  if (windowStart >= start) return false

  let hasLetter = false
  for (let i = start - 1; i >= windowStart; i--) {
    const c = text.charCodeAt(i)
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c > 127) {
      hasLetter = true
      break
    }
  }
  if (!hasLetter) return false

  let windowText = text.slice(windowStart, start)

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
  const firstChar = raw.trimStart()[0]
  if (firstChar !== '0' && firstChar !== '+' && firstChar !== '(' && firstChar !== '8') {
    return null
  }

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

export function isMaskedValue(kind: SensitiveKind, val: string): boolean {
  if (val.includes('*')) return true
  if (val.toLowerCase().includes('@anonymized.invalid')) return true
  if (kind === 'address' && val.includes('****')) return true
  return false
}

const LOCAL_CHAR_MAP = new Uint8Array(128)
for (let i = 0; i < 128; i++) {
  const ch = String.fromCharCode(i)
  if (/[a-zA-Z0-9._%+-]/.test(ch)) LOCAL_CHAR_MAP[i] = 1
}
const DOMAIN_CHAR_MAP = new Uint8Array(128)
for (let i = 0; i < 128; i++) {
  const ch = String.fromCharCode(i)
  if (/[a-zA-Z0-9.-]/.test(ch)) DOMAIN_CHAR_MAP[i] = 1
}

export function findEmails(text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = []
  let atPos = text.indexOf('@')

  const isLocalChar = (code: number) => code < 128 && LOCAL_CHAR_MAP[code] === 1
  const isDomainChar = (code: number) => code < 128 && DOMAIN_CHAR_MAP[code] === 1

  while (atPos !== -1) {
    // Expand left: up to 64 chars
    let left = atPos - 1
    let localCount = 0
    while (left >= 0 && localCount < 64 && isLocalChar(text.charCodeAt(left))) {
      left--
      localCount++
    }
    const localStart = left + 1
    const localPart = text.slice(localStart, atPos)

    // Expand right: up to 253 chars
    let right = atPos + 1
    let domainCount = 0
    while (right < text.length && domainCount < 253 && isDomainChar(text.charCodeAt(right))) {
      right++
      domainCount++
    }
    let domainEnd = right
    // Trim trailing dots or hyphens from domain end
    while (domainEnd > atPos + 1 && (text[domainEnd - 1] === '.' || text[domainEnd - 1] === '-')) {
      domainEnd--
    }
    const domainPart = text.slice(atPos + 1, domainEnd)

    // Validation
    if (
      localPart.length >= 1 &&
      domainPart.length >= 3 &&
      !domainPart.startsWith('.') &&
      !domainPart.startsWith('-') &&
      !domainPart.includes('..')
    ) {
      const lastDot = domainPart.lastIndexOf('.')
      if (lastDot > 0 && lastDot < domainPart.length - 1) {
        const tld = domainPart.slice(lastDot + 1)
        if (/^[a-zA-Z]{2,24}$/.test(tld)) {
          const raw = localPart + '@' + domainPart
          if (!raw.toLowerCase().endsWith('@anonymized.invalid')) {
            matches.push({
              kind: 'email',
              value: raw,
              normalized: raw.trim().toLowerCase(),
              start: localStart,
              end: domainEnd,
            })
          }
        }
      }
    }

    atPos = text.indexOf('@', atPos + 1)
  }

  return matches
}

export function findAddresses(text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = []
  if (!ADDRESS_PRECHECK_REGEX.test(text)) return matches

  const addressRegex = new RegExp(ADDRESS_LABEL_REGEX.source, ADDRESS_LABEL_REGEX.flags)
  let match: RegExpExecArray | null

  while ((match = addressRegex.exec(text)) !== null) {
    const labelEnd = match.index + match[0].length
    const maxSlice = text.slice(labelEnd, labelEnd + 200)

    let stopIndex = maxSlice.length

    // Check semicolon
    const semiIdx = maxSlice.indexOf(';')
    if (semiIdx !== -1 && semiIdx < stopIndex) {
      stopIndex = semiIdx
    }

    // Check newlines
    const nlMatch = maxSlice.search(/[\r\n]/)
    if (nlMatch !== -1 && nlMatch < stopIndex) {
      stopIndex = nlMatch
    }

    // Check stop labels (e.g. Điện thoại, Email, Đại diện...)
    const stopMatch = ADDRESS_STOP_LABEL_REGEX.exec(maxSlice)
    if (stopMatch && stopMatch.index < stopIndex) {
      stopIndex = stopMatch.index
    }

    // Check inline comma stops (, do , , đại diện, , MST...)
    const commaMatch = INLINE_COMMA_STOP_REGEX.exec(maxSlice)
    if (commaMatch && commaMatch.index < stopIndex) {
      stopIndex = commaMatch.index
    }

    // Check inline dot stops (. followed by space and uppercase letter)
    const dotMatch = INLINE_DOT_STOP_REGEX.exec(maxSlice)
    if (dotMatch && dotMatch.index < stopIndex) {
      stopIndex = dotMatch.index
    }

    const rawAddress = maxSlice.slice(0, stopIndex)
    const leadingSpaces = rawAddress.length - rawAddress.trimStart().length
    let cleanAddress = rawAddress.trimStart()
    cleanAddress = cleanAddress.replace(/[.,;:!?-]+$/, '').trimEnd()

    if (cleanAddress.length >= 3) {
      const start = labelEnd + leadingSpaces
      const end = start + cleanAddress.length
      matches.push({
        kind: 'address',
        value: cleanAddress,
        normalized: cleanAddress.normalize('NFC'),
        start,
        end,
      })
      addressRegex.lastIndex = Math.max(addressRegex.lastIndex, end)
    }
  }

  return matches
}

export function findNumbers(text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = []
  const numRegex = new RegExp(NUMBER_CANDIDATE_REGEX.source, NUMBER_CANDIDATE_REGEX.flags)
  let match: RegExpExecArray | null

  while ((match = numRegex.exec(text)) !== null) {
    const raw = match[0]
    const matchStart = match.index
    let end = matchStart + raw.length
    const start = matchStart

    // Boundary check in JS code (zero regex backtracking)
    if (start > 0 && isWordChar(text, start - 1)) {
      continue
    }
    if (end < text.length && isWordChar(text, end)) {
      while (end < text.length && isWordChar(text, end)) {
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
        matches.push({
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
        matches.push({
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
          matches.push({
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
      matches.push({
        kind: 'phone',
        value: raw,
        normalized: normalizedPhone,
        start,
        end,
      })
    }
  }

  // Priority between numbers on overlapping digit spans
  const numberPriority: Record<SensitiveKind, number> = {
    taxCode: 1,
    nationalId: 2,
    bankAccount: 3,
    phone: 4,
    email: 99,
    address: 99,
  }

  matches.sort((a, b) => {
    const prioDiff = numberPriority[a.kind] - numberPriority[b.kind]
    if (prioDiff !== 0) return prioDiff
    const lenDiff = b.end - b.start - (a.end - a.start)
    if (lenDiff !== 0) return lenDiff
    return a.start - b.start
  })

  const selectedNumbers: SensitiveMatch[] = []
  for (const cand of matches) {
    const overlaps = selectedNumbers.some(
      (s) => Math.max(cand.start, s.start) < Math.min(cand.end, s.end)
    )
    if (!overlaps) {
      selectedNumbers.push(cand)
    }
  }

  return selectedNumbers
}

export function findSensitive(text: string): SensitiveMatch[] {
  // 1. Email via linear index search (zero regex backtracking)
  const emails = text.includes('@') ? findEmails(text) : []

  // 2. Numbers (Tax Code, National ID, Bank Account, Phone)
  const numbers = findNumbers(text)

  // Specific matches: merge emails and numbers (resolve any overlap)
  const specificMatches: SensitiveMatch[] = [...emails]
  for (const num of numbers) {
    const overlapsEmail = specificMatches.some(
      (e) => Math.max(num.start, e.start) < Math.min(num.end, e.end)
    )
    if (!overlapsEmail) {
      specificMatches.push(num)
    }
  }

  // 3. Addresses
  const addresses = findAddresses(text)

  // Merge specific matches and address matches without dropping either
  const all = [...specificMatches, ...addresses]
  all.sort((a, b) => a.start - b.start)

  return all
}
