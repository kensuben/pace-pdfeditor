import type { PDFDocument } from 'pdf-lib'
import { PDFDict, PDFName, PDFRawStream, PDFStream } from 'pdf-lib'
import type { ContentOp, Rect } from './types'
import { tokenizeContent, serializeContent } from './contentTokenizer'
import { readPageContent, writePageContent } from './pageContent'
import { multMatrix, applyMatrix } from './textGeometry'

export interface ImageEdit {
  resourceName: string
  occurrence: number
  newBbox?: Rect
  targetMatrix?: [number, number, number, number, number, number]
  clip?: Rect
  replaceWith?: { name: string }
  remove?: boolean
  layer?: 'top' | 'bottom'
  pageMatrix?: [number, number, number, number, number, number]
}


/**
 * Computes the inverse of a 2D affine transformation matrix [a, b, c, d, e, f].
 * Returns null if the matrix is singular (determinant ~ 0).
 */
export function invertMatrix(
  m: [number, number, number, number, number, number],
): [number, number, number, number, number, number] | null {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return null
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ]
}

/**
 * Applies edits to existing PDF images on a specific page via content stream modification.
 * - remove: true removes the `Do` operator.
 * - newBbox: wraps the `Do` operator in `q M cm Do Q` where M = CTM × U × CTM⁻¹.
 * If difference from old bbox is < 0.5pt on all edges, no modification is made.
 */
function makeLayerOps(edit: ImageEdit): ContentOp[] {
  const resName = edit.replaceWith ? edit.replaceWith.name : edit.resourceName
  const cleanName = resName.startsWith('/') ? resName : `/${resName}`
  const ops: ContentOp[] = [{ operator: 'q', operands: [] }]

  if (edit.clip) {
    ops.push({
      operator: 're',
      operands: [
        { type: 'number', value: edit.clip.x },
        { type: 'number', value: edit.clip.y },
        { type: 'number', value: edit.clip.width },
        { type: 'number', value: edit.clip.height },
      ],
    })
    ops.push({ operator: 'W', operands: [] })
    ops.push({ operator: 'n', operands: [] })
  }

  const m = edit.pageMatrix || [1, 0, 0, 1, 0, 0]
  ops.push({
    operator: 'cm',
    operands: [
      { type: 'number', value: m[0] },
      { type: 'number', value: m[1] },
      { type: 'number', value: m[2] },
      { type: 'number', value: m[3] },
      { type: 'number', value: m[4] },
      { type: 'number', value: m[5] },
    ],
  })

  ops.push({
    operator: 'Do',
    operands: [{ type: 'name', value: cleanName }],
  })

  ops.push({ operator: 'Q', operands: [] })
  return ops
}

export function applyImageEdits(
  doc: PDFDocument,
  pageIndex: number,
  edits: ImageEdit[],
): { applied: number; notFound: number } {
  if (edits.length === 0) return { applied: 0, notFound: 0 }

  const pageCount = doc.getPageCount()
  if (pageIndex < 0 || pageIndex >= pageCount) {
    return { applied: 0, notFound: edits.length }
  }

  const bytes = readPageContent(doc, pageIndex)
  if (bytes.length === 0) {
    return { applied: 0, notFound: edits.length }
  }

  let ops: ContentOp[]
  try {
    ops = tokenizeContent(bytes)
  } catch {
    return { applied: 0, notFound: edits.length }
  }

  const page = doc.getPage(pageIndex)
  const res = page.node.Resources()
  const resolvedRes = res instanceof PDFDict ? res : res ? doc.context.lookup(res) : null
  const xobjDictRaw = resolvedRes instanceof PDFDict ? resolvedRes.lookup(PDFName.of('XObject')) : null
  const xobjDict = xobjDictRaw instanceof PDFDict ? xobjDictRaw : xobjDictRaw ? doc.context.lookup(xobjDictRaw) : null

  let ctm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0]
  const ctmStack: Array<[number, number, number, number, number, number]> = []
  const occMap = new Map<string, number>()

  const appliedIndices = new Set<number>()
  const bottomEdits: ImageEdit[] = []
  const topEdits: ImageEdit[] = []
  let hasStructuralChanges = false
  const outOps: ContentOp[] = []

  for (const op of ops) {
    const name = op.operator

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

    if (name === 'Do') {
      if (op.operands.length < 1 || op.operands[0].type !== 'name') {
        outOps.push(op)
        continue
      }

      const rawName = op.operands[0].value
      const cleanName = rawName.startsWith('/') ? rawName.slice(1) : rawName

      // Check if this XObject is Subtype /Image
      let isImage = false
      if (xobjDict instanceof PDFDict) {
        const ref = xobjDict.lookup(PDFName.of(cleanName))
        if (ref) {
          const obj = doc.context.lookup(ref)
          const dict = (obj instanceof PDFRawStream || obj instanceof PDFStream)
            ? (obj as PDFStream).dict
            : obj instanceof PDFDict
              ? obj
              : null
          if (dict && dict.lookup(PDFName.of('Subtype'))?.toString() === '/Image') {
            isImage = true
          }
        }
      }

      if (!isImage) {
        outOps.push(op)
        continue
      }

      const occurrence = occMap.get(cleanName) || 0
      occMap.set(cleanName, occurrence + 1)

      const editIdx = edits.findIndex((e, idx) => {
        if (appliedIndices.has(idx)) return false
        const editCleanName = e.resourceName.startsWith('/') ? e.resourceName.slice(1) : e.resourceName
        return editCleanName === cleanName && e.occurrence === occurrence
      })

      if (editIdx === -1) {
        outOps.push(op)
        continue
      }

      const edit = edits[editIdx]
      appliedIndices.add(editIdx)

      if (edit.layer) {
        hasStructuralChanges = true
        if (edit.layer === 'bottom') {
          bottomEdits.push(edit)
        } else if (edit.layer === 'top') {
          topEdits.push(edit)
        }
        continue
      }

      if (edit.remove) {
        // Drop the Do operator
        hasStructuralChanges = true
        continue
      }

      // Check if replaceWith changes the XObject name
      let doOp = op
      if (edit.replaceWith) {
        hasStructuralChanges = true
        const repName = edit.replaceWith.name.startsWith('/') ? edit.replaceWith.name : `/${edit.replaceWith.name}`
        doOp = { operator: 'Do', operands: [{ type: 'name', value: repName }] }
      }

      if (edit.targetMatrix) {
        // Compute M = targetMatrix × CTM⁻¹
        const invCtm = invertMatrix(ctm)
        if (!invCtm) {
          outOps.push(doOp)
          continue
        }

        const M = multMatrix(edit.targetMatrix, invCtm)

        // Check if M is practically identity, no replacement, and no clip
        const isIdentity =
          Math.abs(M[0] - 1) < 1e-4 &&
          Math.abs(M[1]) < 1e-4 &&
          Math.abs(M[2]) < 1e-4 &&
          Math.abs(M[3] - 1) < 1e-4 &&
          Math.abs(M[4]) < 1e-4 &&
          Math.abs(M[5]) < 1e-4

        if (isIdentity && !edit.replaceWith && !edit.clip) {
          outOps.push(op)
          continue
        }

        hasStructuralChanges = true
        outOps.push({ operator: 'q', operands: [] })

        if (edit.clip) {
          // clip is in PDF page coordinates.
          // Since re W n is placed before cm, transform clip to current CTM coordinate system using CTM⁻¹.
          const c1 = applyMatrix({ x: edit.clip.x, y: edit.clip.y }, invCtm)
          const c2 = applyMatrix({ x: edit.clip.x + edit.clip.width, y: edit.clip.y }, invCtm)
          const c3 = applyMatrix({ x: edit.clip.x + edit.clip.width, y: edit.clip.y + edit.clip.height }, invCtm)
          const c4 = applyMatrix({ x: edit.clip.x, y: edit.clip.y + edit.clip.height }, invCtm)
          const minX = Math.min(c1.x, c2.x, c3.x, c4.x)
          const maxX = Math.max(c1.x, c2.x, c3.x, c4.x)
          const minY = Math.min(c1.y, c2.y, c3.y, c4.y)
          const maxY = Math.max(c1.y, c2.y, c3.y, c4.y)

          outOps.push({
            operator: 're',
            operands: [
              { type: 'number', value: minX },
              { type: 'number', value: minY },
              { type: 'number', value: maxX - minX },
              { type: 'number', value: maxY - minY },
            ],
          })
          outOps.push({ operator: 'W', operands: [] })
          outOps.push({ operator: 'n', operands: [] })
        }

        outOps.push({
          operator: 'cm',
          operands: [
            { type: 'number', value: M[0] },
            { type: 'number', value: M[1] },
            { type: 'number', value: M[2] },
            { type: 'number', value: M[3] },
            { type: 'number', value: M[4] },
            { type: 'number', value: M[5] },
          ],
        })
        outOps.push(doOp)
        outOps.push({ operator: 'Q', operands: [] })
        continue
      }

      if (edit.newBbox) {
        // Compute old bbox from current ctm
        const p1 = applyMatrix({ x: 0, y: 0 }, ctm)
        const p2 = applyMatrix({ x: 1, y: 0 }, ctm)
        const p3 = applyMatrix({ x: 1, y: 1 }, ctm)
        const p4 = applyMatrix({ x: 0, y: 1 }, ctm)

        const minX = Math.min(p1.x, p2.x, p3.x, p4.x)
        const maxX = Math.max(p1.x, p2.x, p3.x, p4.x)
        const minY = Math.min(p1.y, p2.y, p3.y, p4.y)
        const maxY = Math.max(p1.y, p2.y, p3.y, p4.y)

        const oldBbox: Rect = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        }

        const dx = Math.abs(edit.newBbox.x - oldBbox.x)
        const dy = Math.abs(edit.newBbox.y - oldBbox.y)
        const dw = Math.abs(edit.newBbox.width - oldBbox.width)
        const dh = Math.abs(edit.newBbox.height - oldBbox.height)

        if (dx < 0.5 && dy < 0.5 && dw < 0.5 && dh < 0.5 && !edit.replaceWith) {
          // Unchanged (< 0.5pt on all edges) -> leave unchanged
          outOps.push(op)
          continue
        }

        const sx = oldBbox.width === 0 ? 1 : edit.newBbox.width / oldBbox.width
        const sy = oldBbox.height === 0 ? 1 : edit.newBbox.height / oldBbox.height
        const tx = edit.newBbox.x - oldBbox.x * sx
        const ty = edit.newBbox.y - oldBbox.y * sy
        const U: [number, number, number, number, number, number] = [sx, 0, 0, sy, tx, ty]

        const invCtm = invertMatrix(ctm)
        if (!invCtm) {
          outOps.push(doOp)
          continue
        }

        // M = CTM × U × CTM⁻¹
        const M = multMatrix(multMatrix(ctm, U), invCtm)

        hasStructuralChanges = true
        outOps.push({ operator: 'q', operands: [] })
        outOps.push({
          operator: 'cm',
          operands: [
            { type: 'number', value: M[0] },
            { type: 'number', value: M[1] },
            { type: 'number', value: M[2] },
            { type: 'number', value: M[3] },
            { type: 'number', value: M[4] },
            { type: 'number', value: M[5] },
          ],
        })
        outOps.push(doOp)
        outOps.push({ operator: 'Q', operands: [] })
        continue
      }

      if (edit.replaceWith) {
        hasStructuralChanges = true
        outOps.push(doOp)
        continue
      }

      outOps.push(op)
      continue
    }

    outOps.push(op)
  }

  const applied = appliedIndices.size
  const notFound = edits.length - applied

  let finalOps = outOps
  if (bottomEdits.length > 0 || topEdits.length > 0) {
    bottomEdits.sort((a, b) => edits.indexOf(a) - edits.indexOf(b))
    topEdits.sort((a, b) => edits.indexOf(a) - edits.indexOf(b))
    finalOps = []
    for (const edit of bottomEdits) {
      finalOps.push(...makeLayerOps(edit))
    }
    if (topEdits.length > 0) {
      finalOps.push({ operator: 'q', operands: [] })
      finalOps.push(...outOps)
      finalOps.push({ operator: 'Q', operands: [] })
    } else {
      finalOps.push(...outOps)
    }
    for (const edit of topEdits) {
      finalOps.push(...makeLayerOps(edit))
    }
  }

  if (hasStructuralChanges) {
    const serialized = serializeContent(finalOps)
    writePageContent(doc, pageIndex, serialized)
  }

  return { applied, notFound }
}
