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
          for (const reg of regions) {
            if (isRectIntersecting(formBbox, reg)) {
              addSkip('form-xobject')
              break
            }
          }
        }
      }
      outOps.push(op)
      continue
    }

    // Text Showing Operators: Tj, ', ", TJ
    if (name === 'Tj') {
      if (op.operands.length >= 1 && op.operands[0].type === 'string') {
        const metrics = fontCache.getFontMetrics(fontResName)
        if (metrics.approximate) approximateOps++
        if (metrics.isType3) {
          addSkip('type3-font')
          outOps.push(op)
          continue
        }

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

        if (regions.length > 0 && isPointInRegions(cx, cy, regions)) {
          removedOps++
          // Deleted Tj: do not output op
        } else {
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
        if (metrics.isType3) {
          addSkip('type3-font')
          outOps.push(op)
          continue
        }

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

        if (regions.length > 0 && isPointInRegions(cx, cy, regions)) {
          removedOps++
          // Preserve newline effect by replacing with T*
          outOps.push({ operator: 'T*', operands: [] })
        } else {
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
          if (metrics.isType3) {
            addSkip('type3-font')
            outOps.push(op)
            continue
          }

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

          if (regions.length > 0 && isPointInRegions(cx, cy, regions)) {
            removedOps++
            outOps.push({ operator: 'Tw', operands: [op.operands[0]] })
            outOps.push({ operator: 'Tc', operands: [op.operands[1]] })
            outOps.push({ operator: 'T*', operands: [] })
          } else {
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
        if (metrics.isType3) {
          addSkip('type3-font')
          outOps.push(op)
          continue
        }

        interface ElemAnalysis {
          index: number
          isString: boolean
          inRegion: boolean
          advancePt: number
          advanceEm: number
          operand: Operand
        }

        const analyses: ElemAnalysis[] = []

        for (let i = 0; i < arr.length; i++) {
          const el = arr[i]
          if (el.type === 'number') {
            const dispPt = -(el.value / 1000) * fontSize * (hScale / 100)
            tm = multMatrix([1, 0, 0, 1, dispPt, 0], tm)
            analyses.push({
              index: i,
              isString: false,
              inRegion: false,
              advancePt: dispPt,
              advanceEm: -el.value,
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

            // Calculate advance in em (1/1000 em) for kerning replacement
            const advanceEm = (advancePt / (fontSize * (hScale / 100))) * 1000

            tm = multMatrix([1, 0, 0, 1, advancePt, 0], tm)
            analyses.push({
              index: i,
              isString: true,
              inRegion,
              advancePt,
              advanceEm,
              operand: el,
            })
          }
        }

        const stringAnalyses = analyses.filter((a) => a.isString)
        const allInside = stringAnalyses.length > 0 && stringAnalyses.every((a) => a.inRegion)
        const noneInside = stringAnalyses.every((a) => !a.inRegion)

        if (allInside) {
          // Rule 1: Delete whole TJ operator
          removedOps++
        } else if (noneInside) {
          outOps.push(op)
        } else {
          // Rule 2 (K9 expansion): partial removal in TJ
          // Replace string elements in region with kerning numbers (-advanceEm)
          const newArray: Operand[] = []
          for (const a of analyses) {
            if (a.isString && a.inRegion) {
              // Replacing string with negative kerning advances position by advanceEm
              newArray.push({ type: 'number', value: -a.advanceEm })
            } else {
              newArray.push(a.operand)
            }
          }
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
  }
}
