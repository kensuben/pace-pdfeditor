import { LabelSuggestion, SuggestParagraph } from './types'

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ORG_KEYWORDS = [
  'TỔNG CÔNG TY',
  'TONG CONG TY',
  'CÔNG TY',
  'CONG TY',
  'TẬP ĐOÀN',
  'TAP DOAN',
  'TRUNG TÂM',
  'TRUNG TAM',
  'NGÂN HÀNG',
  'NGAN HANG',
  'HỢP TÁC XÃ',
  'HOP TAC XA',
  'CHI NHÁNH',
  'CHI NHANH',
  'VĂN PHÒNG',
  'VAN PHONG',
  'HỘ KINH DOANH',
  'HO KINH DOANH',
  'VIỆN',
  'VIEN',
  'TRƯỜNG',
  'TRUONG',
]

// Authorization pattern: "Giấy (ủy|uỷ) quyền số" (diacritic-insensitive, anywhere in paragraph)
const AUTH_REGEX =
  /(?:giấy|giay)\s+(?:ủy|uỷ|uy)\s+(?:quyền|quyen)\s+(?:số|so)(?:\s*[:.-]\s*|\s+)([^\t\n,)\r]+?)(?=(?:\s+(?:ngày|ngay)\b)|[,)\t\n\r]|$)/gi

// Contract number pattern: "Hợp đồng số" or "Số hợp đồng:"
const CONTRACT_REGEX =
  /(?:(?:hợp|hop)\s+(?:đồng|dong)\s+(?:số|so)|(?:số|so)\s+(?:hợp|hop)\s+(?:đồng|dong)\s*:)(?:\s*[:.-]\s*|\s+)([^\t\n,)\r]+?)(?=(?:\s+(?:ngày|ngay)\b)|[,)\t\n\r]|$)/gi

// Party pattern: "Bên A|B|C|D", "Bên mua", "Bên bán", etc. (with optional role in parentheses)
// Must be at start of paragraph (or after tab) and followed by ":" or "\t"
const PARTY_REGEX =
  /(?:^|[\t\r\n])\s*(?:(?:\d+|[a-zA-Z]|[ivxIVX]+)[.)–—:-]\s*)*(?:bên|ben)\s+(?:[a-d]|mua|bán|ban|thuê|thue|cho\s+thuê|cho\s+thue|giao|nhận|nhan|cung\s+cấp|cung\s+cap|sử\s+dụng|su\s+dung)(?:\s*\([^)]*\))?(?:\s*:\s*|\t\s*)([^\t\r\n]+)/gi

// Representative pattern: "Đại diện", "Người đại diện", "Đại diện bởi", "Đại diện theo pháp luật"
// Must be at start of paragraph or after tab and followed by ":" or "\t"
const REP_REGEX =
  /(?:^|[\t\r\n])\s*(?:(?:\d+|[a-zA-Z]|[ivxIVX]+)[.)–—:-]\s*)*(?:người\s+đại\s+diện|nguoi\s+dai\s+dien|đại\s+diện\s+theo\s+pháp\s+luật|dai\s+dien\s+theo\s+phap\s+luat|đại\s+diện\s+bởi|dai\s+dien\s+boi|đại\s+diện|dai\s+dien)(?:\s*:\s*|\t\s*)([^\t\r\n]+)/gi

// Position pattern: "Chức vụ" ONLY at start of line (after numbering/spaces) OR immediately after tab "\t"
const POS_REGEX =
  /(?:^|[\t\r\n])\s*(?:(?:\d+|[a-zA-Z]|[ivxIVX]+)[.)–—:-]\s*)*(?:chức|chuc)\s+(?:vụ|vu)(?:\s*:\s*|\t\s*)([^\t\r\n]+)/gi

const TITLE_PREFIX_REGEX =
  /^(?:ông\s*\/\s*bà|ong\s*\/\s*ba|ông\.|ong\.|bà\.|ba\.|mr\.|mrs\.|ms\.|ông|ong|bà|ba|mr|mrs|ms)(?=\s|$|[:.-])(?:\s*[:.-]\s*|\s+)/iu

const CONTRACT_LABEL_NAMES = [
  'chức vụ',
  'chuc vu',
  'đại diện',
  'dai dien',
  'người đại diện',
  'nguoi dai dien',
  'đại diện theo pháp luật',
  'dai dien theo phap luat',
  'đại diện bởi',
  'dai dien boi',
  'bên a',
  'ben a',
  'bên b',
  'ben b',
  'bên c',
  'ben c',
  'bên d',
  'ben d',
  'bên mua',
  'ben mua',
  'bên bán',
  'ben ban',
  'bên thuê',
  'ben thue',
  'bên cho thuê',
  'ben cho thue',
  'bên giao',
  'ben giao',
  'bên nhận',
  'ben nhan',
  'bên cung cấp',
  'ben cung cap',
  'bên sử dụng',
  'ben su dung',
  'địa chỉ',
  'dia chi',
  'điện thoại',
  'dien thoai',
  'mã số thuế',
  'ma so thue',
  'fax',
  'email',
  'tài khoản',
  'tai khoan',
  'ngân hàng',
  'ngan hang',
  'hợp đồng',
  'hop dong',
  'hợp đồng số',
  'hop dong so',
  'số hợp đồng',
  'so hop dong',
  'giấy ủy quyền',
  'giay uy quyen',
  'giấy uỷ quyền',
  'giay u y quyen',
  'giấy ủy quyền số',
  'giấy uỷ quyền số',
  'giay uy quyen so',
]

function isLabelName(str: string): boolean {
  const norm = str
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/^[:;,.\-_()"'“”‘’…\s]+/, '')
    .replace(/[:;,.\-_()"'“”‘’…\s]+$/, '')
  return CONTRACT_LABEL_NAMES.includes(norm)
}

function cleanValue(str: string): string {
  let res = str.trim()
  res = res.replace(/^[:;,.\-_()"'“”‘’…\s]+/, '').replace(/[:;,.\-_()"'“”‘’…\s]+$/, '')
  return res.trim().normalize('NFC')
}

function isValidValue(str: string): boolean {
  if (str.length < 3) return false
  // Check if string is only placeholder characters (dots, underscores, dashes, ellipsis)
  if (/^[\s._…\-–—]+$/.test(str)) return false
  return true
}

function cutOrgPrefix(val: string): string {
  let earliestIdx = -1
  for (const kw of ORG_KEYWORDS) {
    const rx = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(kw)}(?![\\p{L}\\p{N}])`, 'gui')
    const match = rx.exec(val)
    if (match) {
      if (earliestIdx === -1 || match.index < earliestIdx) {
        earliestIdx = match.index
      }
    }
  }
  if (earliestIdx !== -1) {
    return val.slice(earliestIdx)
  }
  return val
}

function getOccurrenceSources(
  p: SuggestParagraph,
  valStart: number,
  valEnd: number
): ('body' | 'deleted')[] {
  if (p.charSources && valStart >= 0 && valEnd > valStart) {
    const slice = p.charSources.slice(valStart, valEnd)
    const res: ('body' | 'deleted')[] = []
    if (slice.includes('body')) res.push('body')
    if (slice.includes('deleted')) res.push('deleted')
    if (res.length > 0) return res
  }
  return [p.source]
}

export function suggestFromLabels(paragraphs: SuggestParagraph[]): LabelSuggestion[] {
  const map = new Map<string, LabelSuggestion>()
  const seenInParagraph = new Set<string>()

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const p = paragraphs[pIdx]
    const text = p.text || ''
    if (!text.trim()) continue

    const paraKey = p.paraId !== undefined ? String(p.paraId) : `idx_${pIdx}`

    const registerSuggestion = (item: {
      kind: 'organization' | 'representative' | 'keyword'
      hint: 'party' | 'representative' | 'position' | 'authorization' | 'contractNo'
      value: string
      sources: ('body' | 'deleted')[]
    }) => {
      const normVal = item.value.normalize('NFC').toLowerCase()
      const dedupKey = `${paraKey}|${item.kind}|${item.hint}|${normVal}`
      const isFirstInPara = !seenInParagraph.has(dedupKey)
      if (isFirstInPara) {
        seenInParagraph.add(dedupKey)
      }

      const mapKey = `${item.kind}|${item.hint}|${normVal}`
      const existing = map.get(mapKey)
      if (existing) {
        if (isFirstInPara) {
          existing.count++
        }
        for (const src of item.sources) {
          if (!existing.sources.includes(src)) {
            existing.sources.push(src)
          }
        }
      } else {
        map.set(mapKey, {
          kind: item.kind,
          hint: item.hint,
          value: item.value,
          count: 1,
          sources: [...item.sources],
        })
      }
    }

    // 1. Authorization: Giấy (ủy|uỷ) quyền số (anywhere in paragraph, must contain digit)
    AUTH_REGEX.lastIndex = 0
    let authMatch: RegExpExecArray | null
    while ((authMatch = AUTH_REGEX.exec(text)) !== null) {
      const rawVal = authMatch[1] || ''
      const cleaned = cleanValue(rawVal)
      if (isValidValue(cleaned) && /\d/.test(cleaned) && !isLabelName(cleaned)) {
        const groupOffset = authMatch[0].lastIndexOf(authMatch[1])
        const groupStart = authMatch.index + (groupOffset >= 0 ? groupOffset : 0)
        const cleanedOffset = authMatch[1].indexOf(cleaned)
        const valStart = groupStart + (cleanedOffset >= 0 ? cleanedOffset : 0)
        const valEnd = valStart + cleaned.length
        registerSuggestion({
          kind: 'keyword',
          hint: 'authorization',
          value: cleaned,
          sources: getOccurrenceSources(p, valStart, valEnd),
        })
      }
    }

    // 2. Contract No: Hợp đồng số / Số hợp đồng: (must contain digit)
    CONTRACT_REGEX.lastIndex = 0
    let contractMatch: RegExpExecArray | null
    while ((contractMatch = CONTRACT_REGEX.exec(text)) !== null) {
      const rawVal = contractMatch[1] || ''
      const cleaned = cleanValue(rawVal)
      if (isValidValue(cleaned) && /\d/.test(cleaned) && !isLabelName(cleaned)) {
        const groupOffset = contractMatch[0].lastIndexOf(contractMatch[1])
        const groupStart = contractMatch.index + (groupOffset >= 0 ? groupOffset : 0)
        const cleanedOffset = contractMatch[1].indexOf(cleaned)
        const valStart = groupStart + (cleanedOffset >= 0 ? cleanedOffset : 0)
        const valEnd = valStart + cleaned.length
        registerSuggestion({
          kind: 'keyword',
          hint: 'contractNo',
          value: cleaned,
          sources: getOccurrenceSources(p, valStart, valEnd),
        })
      }
    }

    // 3. Party: Bên A, Bên mua, etc.
    PARTY_REGEX.lastIndex = 0
    let partyMatch: RegExpExecArray | null
    while ((partyMatch = PARTY_REGEX.exec(text)) !== null) {
      let rawVal = partyMatch[1] || ''
      // If there's another label like "\tĐại diện:" in the same segment, truncate
      const stopIdx = rawVal.search(/[\t\r\n]/)
      if (stopIdx !== -1) {
        rawVal = rawVal.slice(0, stopIdx)
      }
      const trimmed = cleanValue(rawVal)
      const afterOrgCut = cutOrgPrefix(trimmed)
      const cleaned = cleanValue(afterOrgCut)
      if (isValidValue(cleaned) && !isLabelName(cleaned)) {
        const groupOffset = partyMatch[0].lastIndexOf(partyMatch[1])
        const groupStart = partyMatch.index + (groupOffset >= 0 ? groupOffset : 0)
        const cleanedOffset = partyMatch[1].indexOf(cleaned)
        const valStart = groupStart + (cleanedOffset >= 0 ? cleanedOffset : 0)
        const valEnd = valStart + cleaned.length
        registerSuggestion({
          kind: 'organization',
          hint: 'party',
          value: cleaned,
          sources: getOccurrenceSources(p, valStart, valEnd),
        })
      }
    }

    // 4. Representative: Đại diện, Người đại diện, etc.
    REP_REGEX.lastIndex = 0
    let repMatch: RegExpExecArray | null
    while ((repMatch = REP_REGEX.exec(text)) !== null) {
      let rawVal = repMatch[1] || ''
      // Up to next "Chức vụ" label / tab / newline
      const posLabelIdx = rawVal.search(/(?:(?:^|[\s\t])(?:chức|chuc)\s+(?:vụ|vu)\s*[:.-]?|\t)/i)
      if (posLabelIdx !== -1) {
        rawVal = rawVal.slice(0, posLabelIdx)
      }
      let cleaned = cleanValue(rawVal)
      // Strip title prefix (Ông, Bà, Mr, Mrs, Ms...)
      cleaned = cleaned.replace(TITLE_PREFIX_REGEX, '')
      cleaned = cleanValue(cleaned)
      if (isValidValue(cleaned) && !isLabelName(cleaned)) {
        const groupOffset = repMatch[0].lastIndexOf(repMatch[1])
        const groupStart = repMatch.index + (groupOffset >= 0 ? groupOffset : 0)
        const cleanedOffset = repMatch[1].indexOf(cleaned)
        const valStart = groupStart + (cleanedOffset >= 0 ? cleanedOffset : 0)
        const valEnd = valStart + cleaned.length
        registerSuggestion({
          kind: 'representative',
          hint: 'representative',
          value: cleaned,
          sources: getOccurrenceSources(p, valStart, valEnd),
        })
      }
    }

    // 5. Position: Chức vụ (only at start of line or immediately after tab)
    POS_REGEX.lastIndex = 0
    let posMatch: RegExpExecArray | null
    while ((posMatch = POS_REGEX.exec(text)) !== null) {
      let rawVal = posMatch[1] || ''
      const stopIdx = rawVal.search(/[\t\r\n]/)
      if (stopIdx !== -1) {
        rawVal = rawVal.slice(0, stopIdx)
      }
      const cleaned = cleanValue(rawVal)
      if (isValidValue(cleaned) && !isLabelName(cleaned)) {
        const groupOffset = posMatch[0].lastIndexOf(posMatch[1])
        const groupStart = posMatch.index + (groupOffset >= 0 ? groupOffset : 0)
        const cleanedOffset = posMatch[1].indexOf(cleaned)
        const valStart = groupStart + (cleanedOffset >= 0 ? cleanedOffset : 0)
        const valEnd = valStart + cleaned.length
        registerSuggestion({
          kind: 'keyword',
          hint: 'position',
          value: cleaned,
          sources: getOccurrenceSources(p, valStart, valEnd),
        })
      }
    }
  }

  return Array.from(map.values())
}
