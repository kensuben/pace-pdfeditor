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

// Party pattern: "Bên A|B|C|D", "Bên mua", "Bên bán", etc.
// Must be at start of paragraph (or after tab) and followed by ":" or "\t"
const PARTY_REGEX =
  /(?:^|[\t\r\n])\s*(?:(?:\d+|[a-zA-Z]|[ivxIVX]+)[.)–—:-]\s*)*(?:bên|ben)\s+(?:[a-d]|mua|bán|ban|thuê|thue|cho\s+thuê|cho\s+thue|giao|nhận|nhan|cung\s+cấp|cung\s+cap|sử\s+dụng|su\s+dung)(?:\s*:\s*|\t\s*)([^\t\r\n]+)/gi

// Representative pattern: "Đại diện", "Người đại diện", "Đại diện bởi", "Đại diện theo pháp luật"
// Must be at start of paragraph or after tab and followed by ":" or "\t"
const REP_REGEX =
  /(?:^|[\t\r\n])\s*(?:(?:\d+|[a-zA-Z]|[ivxIVX]+)[.)–—:-]\s*)*(?:người\s+đại\s+diện|nguoi\s+dai\s+dien|đại\s+diện\s+theo\s+pháp\s+luật|dai\s+dien\s+theo\s+phap\s+luat|đại\s+diện\s+bởi|dai\s+dien\s+boi|đại\s+diện|dai\s+dien)(?:\s*:\s*|\t\s*)([^\t\r\n]+)/gi

// Position pattern: "Chức vụ" (at start of line, after tab, or after spaces within line) followed by ":" or "\t"
const POS_REGEX =
  /(?:^|[\t\r\n]|\s{2,}|\b)(?:chức|chuc)\s+(?:vụ|vu)(?:\s*:\s*|\t\s*)([^\t\r\n]+)/gi

const TITLE_PREFIX_REGEX =
  /^(?:ông\s*\/\s*bà|ong\s*\/\s*ba|ông\.|ong\.|bà\.|ba\.|mr\.|mrs\.|ms\.|ông|ong|bà|ba|mr|mrs|ms)(?=\s|$|[:.-])(?:\s*[:.-]\s*|\s+)/iu

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

export function suggestFromLabels(paragraphs: SuggestParagraph[]): LabelSuggestion[] {
  const map = new Map<string, LabelSuggestion>()

  for (const p of paragraphs) {
    const text = p.text || ''
    if (!text.trim()) continue

    // 1. Authorization: Giấy (ủy|uỷ) quyền số (anywhere in paragraph)
    AUTH_REGEX.lastIndex = 0
    let authMatch: RegExpExecArray | null
    while ((authMatch = AUTH_REGEX.exec(text)) !== null) {
      const rawVal = authMatch[1] || ''
      const cleaned = cleanValue(rawVal)
      if (isValidValue(cleaned)) {
        addSuggestion(map, {
          kind: 'keyword',
          hint: 'authorization',
          value: cleaned,
          source: p.source,
        })
      }
    }

    // 2. Contract No: Hợp đồng số / Số hợp đồng:
    CONTRACT_REGEX.lastIndex = 0
    let contractMatch: RegExpExecArray | null
    while ((contractMatch = CONTRACT_REGEX.exec(text)) !== null) {
      const rawVal = contractMatch[1] || ''
      const cleaned = cleanValue(rawVal)
      if (isValidValue(cleaned)) {
        addSuggestion(map, {
          kind: 'keyword',
          hint: 'contractNo',
          value: cleaned,
          source: p.source,
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
      if (isValidValue(cleaned)) {
        addSuggestion(map, {
          kind: 'organization',
          hint: 'party',
          value: cleaned,
          source: p.source,
        })
      }
    }

    // 4. Representative: Đại diện, Người đại diện, etc.
    REP_REGEX.lastIndex = 0
    let repMatch: RegExpExecArray | null
    while ((repMatch = REP_REGEX.exec(text)) !== null) {
      let rawVal = repMatch[1] || ''
      // Up to next "Chức vụ" label / tab / newline
      const posLabelIdx = rawVal.search(/(?:\s+(?:chức|chuc)\s+(?:vụ|vu)\s*[:.\-\t]|\t)/i)
      if (posLabelIdx !== -1) {
        rawVal = rawVal.slice(0, posLabelIdx)
      }
      let cleaned = cleanValue(rawVal)
      // Strip title prefix (Ông, Bà, Mr, Mrs, Ms...)
      cleaned = cleaned.replace(TITLE_PREFIX_REGEX, '')
      cleaned = cleanValue(cleaned)
      if (isValidValue(cleaned)) {
        addSuggestion(map, {
          kind: 'representative',
          hint: 'representative',
          value: cleaned,
          source: p.source,
        })
      }
    }

    // 5. Position: Chức vụ
    POS_REGEX.lastIndex = 0
    let posMatch: RegExpExecArray | null
    while ((posMatch = POS_REGEX.exec(text)) !== null) {
      let rawVal = posMatch[1] || ''
      const stopIdx = rawVal.search(/[\t\r\n]/)
      if (stopIdx !== -1) {
        rawVal = rawVal.slice(0, stopIdx)
      }
      const cleaned = cleanValue(rawVal)
      if (isValidValue(cleaned)) {
        addSuggestion(map, {
          kind: 'keyword',
          hint: 'position',
          value: cleaned,
          source: p.source,
        })
      }
    }
  }

  return Array.from(map.values())
}

function addSuggestion(
  map: Map<string, LabelSuggestion>,
  item: {
    kind: 'organization' | 'representative' | 'keyword'
    hint: 'party' | 'representative' | 'position' | 'authorization' | 'contractNo'
    value: string
    source: 'body' | 'deleted'
  }
) {
  const key = `${item.kind}|${item.hint}|${item.value.normalize('NFC').toLowerCase()}`
  const existing = map.get(key)
  if (existing) {
    existing.count++
    if (!existing.sources.includes(item.source)) {
      existing.sources.push(item.source)
    }
  } else {
    map.set(key, {
      kind: item.kind,
      hint: item.hint,
      value: item.value,
      count: 1,
      sources: [item.source],
    })
  }
}
