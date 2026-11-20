import type { PDFDocument } from 'pdf-lib'
import { tokenizeContent, serializeContent } from './contentTokenizer'
import { readPageContent, writePageContent } from './pageContent'
import {
  multMatrix,
  computeTextAdvanceAndBbox,
  FontMetricsCache,
  inspectFormXObject,
} from './textGeometry'
import type { ContentOp, Operand, Rect, RemovalReport, SkipReason } from './types'

function isRectIntersecting(r1: Rect, r2: Rect): boolean {
  return (
    r1.x < r2.x + r2.width &&
    r1.x + r1.width > r2.x &&
    r1.y < r2.y + r2.height &&
    r1.y + r1.height > r2.y
  )
}

function isPointInRegions(x: number, y: number, regions: Rect[]): boolean {
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
      return true
    }
  }
  return false
}

export function pagesWithRemainingText(reports: Map<number, RemovalReport>): number[] {
  const pages: number[] = []
  for (const [page, rep] of reports.entries()) {
    const hasSkipped = rep.skipped.some((s) => s.count > 0)
    if (rep.keptIntersecting > 0 || hasSkipped) {
      pages.push(page)
    }
  }
  return pages.sort((a, b) => a - b)
}

export function removeTextInRegions(
  doc: PDFDocument,
  pageIndex: number,
  regions: Rect[],
): RemovalReport {
  const skippedMap = new Map<SkipReason, number>()
  function addSkip(reason: SkipReason) {
    skippedMap.set(reason, (skippedMap.get(reason) || 0) + 1)
  }

  const rawBytes = readPageContent(doc, pageIndex)
  if (!rawBytes || rawBytes.length === 0) {
    return {
      removedOps: 0,
      partialOps: 0,
      skipped: [],
      approximateOps: 0,
      keptIntersecting: 0,
    }
  }

  let ops: ContentOp[]
  try {
    ops = tokenizeContent(rawBytes)
  } catch {
    addSkip('decode-error')
    return {
      removedOps: 0,
      partialOps: 0,
      skipped: [{ reason: 'decode-error', count: 1 }],
      approximateOps: 0,
      keptIntersecting: 0,
    }
  }

  const fontCache = new FontMetricsCache(doc, pageIndex)

  let ctm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
  const ctmStack: Array<[number, number, number, number, number, number]> = []

  let tm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
  let tlm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]

  let fontResName = ''
  let fontSize = 12
  let leading = 0
  let charSpace = 0
  let wordSpace = 0
  let hScale = 100
  let textRise = 0

  let removedOps = 0
  let partialOps = 0
  let approximateOps = 0
  let keptIntersecting = 0

  const outOps: ContentOp[] = []

  for (let opIdx = 0; opIdx < ops.length; opIdx++) {
    const op = ops[opIdx]
    const name = op.operator

    // Graphics State
    if (name === 'q') {
      ctmStack.push([...ctm])
      outOps.push(op)
      continue
    }

    if (name === 'Q') {
      if (ctmStack.length > 0) {
        ctm = ctmStack.pop()!
      }
      outOps.push(op)
      continue
    }

    if (name === 'cm') {
      if (op.operands.length >= 6) {
        const a = (op.operands[0] as { value: number }).value
        const b = (op.operands[1] as { value: number }).value
        const c = (op.operands[2] as { value: number }).value
        const d = (op.operands[3] as { value: number }).value
        const e = (op.operands[4] as { value: number }).value
        const f = (op.operands[5] as { value: number }).value
        ctm = multMatrix([a, b, c, d, e, f], ctm)
      }
      outOps.push(op)
      continue
    }

    // Text Object and State
    if (name === 'BT') {
      tm = [1, 0, 0, 1, 0, 0]
      tlm = [1, 0, 0, 1, 0, 0]
      outOps.push(op)
      continue
    }

    if (name === 'ET') {
      outOps.push(op)
      continue
    }

    if (name === 'Tf') {
      if (op.operands.length >= 2) {
        fontResName = (op.operands[0] as { value: string }).value
        fontSize = (op.operands[1] as { value: number }).value
      }
      outOps.push(op)
      continue
    }

    if (name === 'TL') {
      if (op.operands.length >= 1) {
        leading = (op.operands[0] as { value: number }).value
      }
      outOps.push(op)
      continue
    }

    if (name === 'Tc') {
      if (op.operands.length >= 1) {
        charSpace = (op.operands[0] as { value: number }).value
      }
      outOps.push(op)
      continue
    }

    if (name === 'Tw') {
      if (op.operands.length >= 1) {
        wordSpace = (op.operands[0] as { value: number }).value
      }
      outOps.push(op)
      continue
    }

    if (name === 'Tz') {
      if (op.operands.length >= 1) {
        hScale = (op.operands[0] as { value: number }).value
      }
      outOps.push(op)
      continue
    }

    if (name === 'Ts') {
      if (op.operands.length >= 1) {
        textRise = (op.operands[0] as { value: number }).value
      }
      outOps.push(op)
      continue
    }

    // Text Positioning
    if (name === 'Td') {
      if (op.operands.length >= 2) {
        const tx = (op.operands[0] as { value: number }).value
        const ty = (op.operands[1] as { value: number }).value
        tlm = multMatrix([1, 0, 0, 1, tx, ty], tlm)
        tm = [...tlm]
      }
      outOps.push(op)
      continue
    }

    if (name === 'TD') {
      if (op.operands.length >= 2) {
        const tx = (op.operands[0] as { value: number }).value
        const ty = (op.operands[1] as { value: number }).value
        leading = -ty
        tlm = multMatrix([1, 0, 0, 1, tx, ty], tlm)
        tm = [...tlm]
      }
      outOps.push(op)
      continue
    }

    if (name === 'Tm') {
      if (op.operands.length >= 6) {
        const a = (op.operands[0] as { value: number }).value
        const b = (op.operands[1] as { value: number }).value
        const c = (op.operands[2] as { value: number }).value
        const d = (op.operands[3] as { value: number }).value
        const e = (op.operands[4] as { value: number }).value
        const f = (op.operands[5] as { value: number }).value
        tm = [a, b, c, d, e, f]
        tlm = [a, b, c, d, e, f]
      }
      outOps.push(op)
      continue
    }

    if (name === 'T*') {
      tlm = multMatrix([1, 0, 0, 1, 0, -leading], tlm)
      tm = [...tlm]
      outOps.push(op)
      continue
    }

    // XObject Call
    if (name === 'Do') {
      if (op.operands.length >= 1 && op.operands[0].type === 'name') {
        const formBbox = inspectFormXObject(doc, pageIndex, op.operands[0].value, ctm)
        if (formBbox) {
          const intersects = regions.some((reg) => isRectIntersecting(formBbox, reg))
          if (intersects) {
            addSkip('form-xobject')
            keptIntersecting++
          }
        }
      }
      outOps.push(op)
      continue
    }

    // Text Showing Operators: Tj, ', ", TJ
    const Th = hScale / 100
    const isZeroScale = fontSize === 0 || Th === 0

    if (name === 'Tj') {
      if (op.operands.length >= 1 && op.operands[0].type === 'string') {
        const metrics = fontCache.getFontMetrics(fontResName)
        if (metrics.approximate) approximateOps++

        const { advancePt, bbox } = computeTextAdvanceAndBbox(
          op.operands[0].bytes,
          metrics,
          fontSize,
          charSpace,
          wordSpace,
          hScale,
          textRise,
          tm,
          ctm,
        )

        const cx = bbox.x + bbox.width / 2
        const cy = bbox.y + bbox.height / 2
        const intersects = regions.some((r) => isRectIntersecting(bbox, r) || isPointInRegions(cx, cy, [r]))
        const inside = regions.length > 0 && isPointInRegions(cx, cy, regions)
        const target = inside || intersects

        if (target && isZeroScale) {
          addSkip('zero-scale')
          keptIntersecting++
          outOps.push(op)
        } else if (target && metrics.isType3) {
          addSkip('type3-font')
          keptIntersecting++
          outOps.push(op)
        } else if (inside) {
          removedOps++
          // Rule A: Replace whole text op with [n] TJ where n = -(tx * 1000) / (fontSize * Th)
          const n = -(advancePt * 1000) / (fontSize * Th)
          outOps.push({
            operator: 'TJ',
            operands: [{ type: 'array', value: [{ type: 'number', value: n }] }],
          })
        } else {
          if (intersects) keptIntersecting++
          outOps.push(op)
        }

        tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
        continue
      }
      outOps.push(op)
      continue
    }

    if (name === "'") {
      // Move to next line and show text
      tlm = multMatrix([1, 0, 0, 1, 0, -leading], tlm)
      tm = [...tlm]

      if (op.operands.length >= 1 && op.operands[0].type === 'string') {
        const metrics = fontCache.getFontMetrics(fontResName)
        if (metrics.approximate) approximateOps++

        const { advancePt, bbox } = computeTextAdvanceAndBbox(
          op.operands[0].bytes,
          metrics,
          fontSize,
          charSpace,
          wordSpace,
          hScale,
          textRise,
          tm,
          ctm,
        )

        const cx = bbox.x + bbox.width / 2
        const cy = bbox.y + bbox.height / 2
        const intersects = regions.some((r) => isRectIntersecting(bbox, r) || isPointInRegions(cx, cy, [r]))
        const inside = regions.length > 0 && isPointInRegions(cx, cy, regions)
        const target = inside || intersects

        if (target && isZeroScale) {
          addSkip('zero-scale')
          keptIntersecting++
          outOps.push(op)
        } else if (target && metrics.isType3) {
          addSkip('type3-font')
          keptIntersecting++
          outOps.push(op)
        } else if (inside) {
          removedOps++
          // Rule A: Replace ' with T* then [n] TJ
          const n = -(advancePt * 1000) / (fontSize * Th)
          outOps.push({ operator: 'T*', operands: [] })
          outOps.push({
            operator: 'TJ',
            operands: [{ type: 'array', value: [{ type: 'number', value: n }] }],
          })
        } else {
          if (intersects) keptIntersecting++
          outOps.push(op)
        }

        tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
        continue
      }
      outOps.push(op)
      continue
    }

    if (name === '"') {
      // Set word space, char space, move to next line, show text
      if (op.operands.length >= 3) {
        wordSpace = (op.operands[0] as { value: number }).value
        charSpace = (op.operands[1] as { value: number }).value
        tlm = multMatrix([1, 0, 0, 1, 0, -leading], tlm)
        tm = [...tlm]

        if (op.operands[2].type === 'string') {
          const metrics = fontCache.getFontMetrics(fontResName)
          if (metrics.approximate) approximateOps++

          const { advancePt, bbox } = computeTextAdvanceAndBbox(
            op.operands[2].bytes,
            metrics,
            fontSize,
            charSpace,
            wordSpace,
            hScale,
            textRise,
            tm,
            ctm,
          )

          const cx = bbox.x + bbox.width / 2
          const cy = bbox.y + bbox.height / 2
          const intersects = regions.some((r) => isRectIntersecting(bbox, r) || isPointInRegions(cx, cy, [r]))
          const inside = regions.length > 0 && isPointInRegions(cx, cy, regions)
          const target = inside || intersects

          if (target && isZeroScale) {
            addSkip('zero-scale')
            keptIntersecting++
            outOps.push(op)
          } else if (target && metrics.isType3) {
            addSkip('type3-font')
            keptIntersecting++
            outOps.push(op)
          } else if (inside) {
            removedOps++
            // Rule A: Replace " with Tw, Tc, T* then [n] TJ
            const n = -(advancePt * 1000) / (fontSize * Th)
            outOps.push({ operator: 'Tw', operands: [op.operands[0]] })
            outOps.push({ operator: 'Tc', operands: [op.operands[1]] })
            outOps.push({ operator: 'T*', operands: [] })
            outOps.push({
              operator: 'TJ',
              operands: [{ type: 'array', value: [{ type: 'number', value: n }] }],
            })
          } else {
            if (intersects) keptIntersecting++
            outOps.push(op)
          }

          tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
          continue
        }
      }
      outOps.push(op)
      continue
    }

    if (name === 'TJ') {
      if (op.operands.length >= 1 && op.operands[0].type === 'array') {
        const arr = op.operands[0].value
        const metrics = fontCache.getFontMetrics(fontResName)
        if (metrics.approximate) approximateOps++

        interface ElemAnalysis {
          index: number
          isString: boolean
          inRegion: boolean
          intersects: boolean
          advancePt: number
          compensationN: number
          operand: Operand
        }

        const analyses: ElemAnalysis[] = []

        for (let i = 0; i < arr.length; i++) {
          const el = arr[i]
          if (el.type === 'number') {
            const dispPt = -(el.value / 1000) * fontSize * Th
            tm = multMatrix([1, 0, 0, 1, dispPt, 0], tm)
            analyses.push({
              index: i,
              isString: false,
              inRegion: false,
              intersects: false,
              advancePt: dispPt,
              compensationN: el.value,
              operand: el,
            })
          } else if (el.type === 'string') {
            const { advancePt, bbox } = computeTextAdvanceAndBbox(
              el.bytes,
              metrics,
              fontSize,
              charSpace,
              wordSpace,
              hScale,
              textRise,
              tm,
              ctm,
            )
            const cx = bbox.x + bbox.width / 2
            const cy = bbox.y + bbox.height / 2
            const inRegion = regions.length > 0 && isPointInRegions(cx, cy, regions)
            const intersects = regions.some((r) => isRectIntersecting(bbox, r) || isPointInRegions(cx, cy, [r]))

            const compensationN = isZeroScale ? 0 : -(advancePt * 1000) / (fontSize * Th)

            tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
            analyses.push({
              index: i,
              isString: true,
              inRegion,
              intersects,
              advancePt,
              compensationN,
              operand: el,
            })
          }
        }

        const anyTarget = analyses.some((a) => a.isString && (a.intersects || a.inRegion))

        if (isZeroScale) {
          if (anyTarget) {
            addSkip('zero-scale')
            keptIntersecting++
          }
          outOps.push(op)
          continue
        }

        if (metrics.isType3) {
          if (anyTarget) {
            addSkip('type3-font')
            keptIntersecting++
          }
          outOps.push(op)
          continue
        }

        const stringAnalyses = analyses.filter((a) => a.isString)
        const allInside = stringAnalyses.length > 0 && stringAnalyses.every((a) => a.inRegion)
        const noneInside = stringAnalyses.every((a) => !a.inRegion)

        if (allInside) {
          // Rule A: Entire TJ is removed -> replace with [totalN] TJ
          let totalAdvancePt = 0
          for (const a of analyses) {
            totalAdvancePt += a.advancePt
          }
          const totalN = -(totalAdvancePt * 1000) / (fontSize * Th)
          removedOps++
          outOps.push({
            operator: 'TJ',
            operands: [{ type: 'array', value: [{ type: 'number', value: totalN }] }],
          })
        } else if (noneInside) {
          // Entire TJ kept
          const anyIntersects = stringAnalyses.some((a) => a.intersects)
          if (anyIntersects) keptIntersecting++
          outOps.push(op)
        } else {
          // Rule C: Partial TJ removal
          // Replace each deleted string element with its exact compensation number: n = -(tx * 1000) / (Tfs * Th)
          const newArray: Operand[] = []
          let keptIntersects = false

          for (const a of analyses) {
            if (a.isString && a.inRegion) {
              newArray.push({ type: 'number', value: a.compensationN })
            } else {
              newArray.push(a.operand)
              if (a.isString && a.intersects) {
                keptIntersects = true
              }
            }
          }

          if (keptIntersects) keptIntersecting++
          partialOps++
          outOps.push({
            operator: 'TJ',
            operands: [{ type: 'array', value: newArray }],
          })
        }
        continue
      }
      outOps.push(op)
      continue
    }

    // Default: other operators unchanged
    outOps.push(op)
  }

  // Serialize updated content and write back to page
  const updatedBytes = serializeContent(outOps)
  writePageContent(doc, pageIndex, updatedBytes)

  const skipped: Array<{ reason: SkipReason; count: number }> = []
  for (const [reason, count] of skippedMap.entries()) {
    skipped.push({ reason, count })
  }

  return {
    removedOps,
    partialOps,
    skipped,
    approximateOps,
    keptIntersecting,
  }
}
