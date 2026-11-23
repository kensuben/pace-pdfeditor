import * as pdfjs from 'pdfjs-dist'

export type RemainingTextReason = 'kept-intersecting' | 'skipped' | 'ocr-image' | 'residual-text'

export interface ResidualCheck {
  page: number
  rect: { x: number; y: number; width: number; height: number }
  originalText: string
  newText: string
}

export function normalizeText(str: string): string {
  return str.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * Searches exported PDF bytes for any occurrences of originalText within target bounding boxes.
 * Skips checks if originalText is empty or if newText already contains originalText.
 * Returns sorted unique 1-based page numbers that still contain original text.
 */
export async function findRemainingOriginalText(
  outBytes: Uint8Array,
  checks: ResidualCheck[]
): Promise<number[]> {
  const activeChecks = checks.filter((c) => {
    const orig = normalizeText(c.originalText || '')
    const next = normalizeText(c.newText || '')
    if (!orig) return false
    // Skip check if newText (normalized) contains originalText
    if (next && next.includes(orig)) return false
    return true
  })

  if (activeChecks.length === 0) return []

  const doc = await pdfjs.getDocument({ data: outBytes.slice() }).promise
  const badPages = new Set<number>()

  // Group checks by 1-based page number
  const checksByPage = new Map<number, ResidualCheck[]>()
  for (const c of activeChecks) {
    if (!checksByPage.has(c.page)) checksByPage.set(c.page, [])
    checksByPage.get(c.page)!.push(c)
  }

  for (const [pageNumber, pageChecks] of checksByPage.entries()) {
    if (pageNumber < 1 || pageNumber > doc.numPages) continue
    const pdfPage = await doc.getPage(pageNumber)
    const viewport = pdfPage.getViewport({ scale: 1 })
    const textContent = await pdfPage.getTextContent()

    // Transform all items into normalized viewport coordinates (0 to 1)
    const items: Array<{ str: string; x: number; y: number; width: number; height: number }> = []
    for (const raw of textContent.items) {
      if (!raw || typeof raw !== 'object' || !('str' in raw)) continue
      const rawItem = raw as { str: string; transform?: number[]; width?: number; height?: number }
      if (!rawItem.transform || !Array.isArray(rawItem.transform)) continue

      // TODO(verify): pdfjs.Util.transform transforms item.transform into viewport coordinates at scale 1
      const tx = pdfjs.Util.transform(viewport.transform, rawItem.transform)
      const fontHeight = Math.max(Math.hypot(tx[2], tx[3]), rawItem.height || 8)
      const itemWidth = rawItem.width ?? fontHeight

      const itemX = tx[4] / viewport.width
      const itemY = (tx[5] - fontHeight) / viewport.height
      const itemW = itemWidth / viewport.width
      const itemH = fontHeight / viewport.height

      items.push({
        str: rawItem.str,
        x: itemX,
        y: itemY,
        width: itemW,
        height: itemH,
      })
    }

    // For each check on this page, find intersecting items
    for (const check of pageChecks) {
      const normOrig = normalizeText(check.originalText)
      // Expanded by 2pt in ratio
      const padX = 2 / viewport.width
      const padY = 2 / viewport.height

      const rX0 = check.rect.x - padX
      const rX1 = check.rect.x + check.rect.width + padX
      const rY0 = check.rect.y - padY
      const rY1 = check.rect.y + check.rect.height + padY

      const intersectingItems = items.filter((it) => {
        return (
          it.x < rX1 &&
          it.x + it.width > rX0 &&
          it.y < rY1 &&
          it.y + it.height > rY0
        )
      })

      if (intersectingItems.length === 0) continue

      const rawJoined = intersectingItems.map((it) => it.str).join('')
      const spaceJoined = intersectingItems.map((it) => it.str).join(' ')

      if (
        normalizeText(rawJoined).includes(normOrig) ||
        normalizeText(spaceJoined).includes(normOrig)
      ) {
        badPages.add(pageNumber)
        break
      }
    }
  }

  return Array.from(badPages).sort((a, b) => a - b)
}

/**
 * Formats user-facing warning message in Vietnamese listing pages and human-readable reasons.
 * Does not include original or replacement text.
 */
export function formatRemainingTextWarning(
  warnings: Array<{ page: number; reason: RemainingTextReason; regionCount?: number }>
): string {
  if (!warnings || warnings.length === 0) return ''

  const reasonLabels: Record<RemainingTextReason, string> = {
    'kept-intersecting': 'chữ cũ nằm chung lệnh vẽ với chữ cần giữ nên chỉ được che bằng nền',
    'skipped': 'chữ nằm trong khối đặc biệt (Form XObject/Type3) nên chỉ được che bằng nền',
    'ocr-image': 'chữ nằm trong ảnh scan nên chỉ được che, chưa xoá khỏi ảnh',
    'residual-text': 'kiểm tra sau khi xuất vẫn tìm thấy chữ cũ',
  }

  const pageMap = new Map<number, Set<string>>()
  for (const w of warnings) {
    if (!pageMap.has(w.page)) pageMap.set(w.page, new Set())
    const text = reasonLabels[w.reason] || w.reason
    pageMap.get(w.page)!.add(text)
  }

  const sortedPages = Array.from(pageMap.keys()).sort((a, b) => a - b)
  const lines: string[] = [
    'Cảnh báo: Tài liệu xuất vẫn còn chứa chữ cũ ở một số trang:',
  ]

  for (const p of sortedPages) {
    const reasons = Array.from(pageMap.get(p)!)
    lines.push(`- Trang ${p}: ${reasons.join('; ')}.`)
  }

  lines.push('')
  lines.push(
    'Lưu ý: Người nhận vẫn có thể copy/tìm thấy chữ cũ; không dùng file này để xoá thông tin nhạy cảm.'
  )
  lines.push('Bạn có muốn tiếp tục tải về không?')

  return lines.join('\n')
}
