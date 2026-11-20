import { PDFDocument, degrees } from 'pdf-lib'
import type { Annotation } from '../types'

export async function rotatePage(
  bytes: Uint8Array,
  pageIndex: number,
  delta: number = 90,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes)
  const page = document.getPage(pageIndex)
  const currentAngle = page.getRotation().angle
  const nextAngle = (((currentAngle + delta) % 360) + 360) % 360
  page.setRotation(degrees(nextAngle))
  return new Uint8Array(await document.save())
}

export async function insertPdfPages(
  targetBytes: Uint8Array,
  sourceBytes: Uint8Array,
  afterPage: number,
): Promise<{ bytes: Uint8Array; insertedCount: number }> {
  const source = await PDFDocument.load(sourceBytes)
  const target = await PDFDocument.load(targetBytes)
  const copied = await target.copyPages(source, source.getPageIndices())
  copied.forEach((copiedPage, index) => target.insertPage(afterPage + index, copiedPage))
  const merged = new Uint8Array(await target.save())
  return { bytes: merged, insertedCount: copied.length }
}

export async function movePage(
  bytes: Uint8Array,
  fromIndex: number,
  toIndex: number,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes)
  const movingPage = document.getPage(fromIndex)
  document.removePage(fromIndex)
  document.insertPage(toIndex, movingPage)
  return new Uint8Array(await document.save())
}

export async function deletePage(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes)
  document.removePage(pageIndex)
  return new Uint8Array(await document.save())
}

export function remapAnnotationsOnInsert(
  annotations: Annotation[],
  afterPage: number,
  insertedCount: number,
): Annotation[] {
  return annotations.map((a) => (a.page > afterPage ? { ...a, page: a.page + insertedCount } : a))
}

export function remapAnnotationsOnMove(
  annotations: Annotation[],
  fromPage: number,
  toPage: number,
): Annotation[] {
  return annotations.map((annotation) =>
    annotation.page === fromPage
      ? { ...annotation, page: toPage }
      : annotation.page === toPage
      ? { ...annotation, page: fromPage }
      : annotation,
  )
}

export function remapAnnotationsOnDelete(
  annotations: Annotation[],
  deletedPage: number,
): Annotation[] {
  return annotations
    .filter((annotation) => annotation.page !== deletedPage)
    .map((annotation) => (annotation.page > deletedPage ? { ...annotation, page: annotation.page - 1 } : annotation))
}
