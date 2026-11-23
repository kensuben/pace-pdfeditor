import { PDFDocument, rgb, StandardFonts, degrees, BlendMode, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import beRegular from './fonts/BeVietnamPro-Regular.ttf?url'
import beItalic from './fonts/BeVietnamPro-Italic.ttf?url'
import beBold from './fonts/BeVietnamPro-Bold.ttf?url'
import beBoldItalic from './fonts/BeVietnamPro-BoldItalic.ttf?url'
import arimoRegular from './fonts/Arimo-Regular.ttf?url'
import arimoItalic from './fonts/Arimo-Italic.ttf?url'
import arimoBold from './fonts/Arimo-Bold.ttf?url'
import arimoBoldItalic from './fonts/Arimo-BoldItalic.ttf?url'
import tinosRegular from './fonts/Tinos-Regular.ttf?url'
import tinosItalic from './fonts/Tinos-Italic.ttf?url'
import tinosBold from './fonts/Tinos-Bold.ttf?url'
import tinosBoldItalic from './fonts/Tinos-BoldItalic.ttf?url'
import type { Annotation } from '../types'
import { hexToRgb01 } from './geometry'
import { resolveExportFontFamily } from './fonts'
import { getPageView, viewSizePt, viewToPdf } from './pageGeometry'
import { removeTextInRegions, pagesWithRemainingText } from './engine/textRemoval'
import type { Rect, RemovalReport } from './engine/types'
import type { RemainingTextReason } from './residualCheck'

export type { RemainingTextReason }

export interface ExportTextReport {
  editedPages: number[]
  cleanedPages: number[]
  maskedPages: number[]
  warnings: Array<{ page: number; reason: RemainingTextReason; regionCount: number }>
  overflowPages: number[]
}

export interface BuildPdfOptions {
  loadFontBytes?: (family: string, variant: string) => Promise<ArrayBuffer>
  loadImageBytes?: (dataUrl: string) => Promise<ArrayBuffer>
  forceMaskPages?: number[]
}

export type BuildEditedPdfOptions = BuildPdfOptions

const exportFontUrls: Record<'Be Vietnam Pro' | 'Arimo' | 'Tinos', Record<'regular' | 'italic' | 'bold' | 'bolditalic', string>> = {
  'Be Vietnam Pro': {
    regular: beRegular,
    italic: beItalic,
    bold: beBold,
    bolditalic: beBoldItalic,
  },
  Arimo: {
    regular: arimoRegular,
    italic: arimoItalic,
    bold: arimoBold,
    bolditalic: arimoBoldItalic,
  },
  Tinos: {
    regular: tinosRegular,
    italic: tinosItalic,
    bold: tinosBold,
    bolditalic: tinosBoldItalic,
  },
}

const defaultLoadFontBytes = async (family: string, variant: string): Promise<ArrayBuffer> => {
  const fontUrl = exportFontUrls[family as keyof typeof exportFontUrls]?.[variant as 'regular' | 'italic' | 'bold' | 'bolditalic']
  if (!fontUrl) throw new Error(`FONT_LOAD_FAILED: Font url not found for ${family} ${variant}`)
  const response = await fetch(fontUrl)
  if (!response.ok) {
    throw new Error(`FONT_LOAD_FAILED: HTTP ${response.status} loading font for ${family} ${variant}`)
  }
  return response.arrayBuffer()
}

const defaultLoadImageBytes = async (dataUrl: string): Promise<ArrayBuffer> => {
  const response = await fetch(dataUrl)
  return response.arrayBuffer()
}

export function wrapTextToWidth(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  if (!text) return ['']
  const paragraphs = text.split('\n')
  const result: string[] = []

  for (const para of paragraphs) {
    if (!para) {
      result.push('')
      continue
    }

    const words = para.split(' ')
    let currentLine = ''

    const pushWord = (word: string) => {
      if (!word) {
        if (currentLine === '') {
          currentLine = ' '
        } else {
          currentLine += ' '
        }
        return
      }

      if (currentLine === '') {
        if (measure(word) <= maxWidth) {
          currentLine = word
        } else {
          let chunk = ''
          for (const ch of word) {
            const next = chunk + ch
            if (chunk && measure(next) > maxWidth) {
              result.push(chunk)
              chunk = ch
            } else {
              chunk = next
            }
          }
          currentLine = chunk
        }
      } else {
        const withWord = currentLine + ' ' + word
        if (measure(withWord) <= maxWidth) {
          currentLine = withWord
        } else {
          result.push(currentLine)
          currentLine = ''
          if (measure(word) <= maxWidth) {
            currentLine = word
          } else {
            let chunk = ''
            for (const ch of word) {
              const next = chunk + ch
              if (chunk && measure(next) > maxWidth) {
                result.push(chunk)
                chunk = ch
              } else {
                chunk = next
              }
            }
            currentLine = chunk
          }
        }
      }
    }

    for (const w of words) {
      pushWord(w)
    }

    if (currentLine !== '') {
      result.push(currentLine)
    }
  }

  return result
}

export async function buildEditedPdfWithReport(
  bytes: Uint8Array,
  annotations: Annotation[],
  options?: BuildPdfOptions,
): Promise<{ bytes: Uint8Array; report: ExportTextReport }> {
  const loadFontBytes = options?.loadFontBytes || defaultLoadFontBytes
  const loadImageBytes = options?.loadImageBytes || defaultLoadImageBytes
  const forceMaskPages = options?.forceMaskPages || []

  const doc = await PDFDocument.load(bytes)
  doc.registerFontkit(fontkit)

  // (a) Group annotations with type === 'text' && replaceOriginal by page
  const replacementAnns = annotations.filter(
    (a) => a.type === 'text' && a.replaceOriginal
  )
  const editedPagesSet = new Set<number>()
  for (const a of replacementAnns) {
    editedPagesSet.add(a.page)
  }
  const editedPages = Array.from(editedPagesSet).sort((a, b) => a - b)

  const removalReports = new Map<number, RemovalReport>()
  const pageOcrCounts = new Map<number, number>()
  const warnings: Array<{ page: number; reason: RemainingTextReason; regionCount: number }> = []
  const overflowPagesSet = new Set<number>()

  // (b) For each page with at least 1 annotation with originalSource !== 'ocr':
  for (const pageNumber of editedPages) {
    const pageAnns = replacementAnns.filter((a) => a.page === pageNumber)
    const ocrAnns = pageAnns.filter((a) => a.originalSource === 'ocr')
    const nativeAnns = pageAnns.filter((a) => a.originalSource !== 'ocr')

    if (ocrAnns.length > 0) {
      pageOcrCounts.set(pageNumber, ocrAnns.length)
      warnings.push({
        page: pageNumber,
        reason: 'ocr-image',
        regionCount: ocrAnns.length,
      })
    }

    if (nativeAnns.length > 0) {
      const pageIndex = pageNumber - 1
      if (pageIndex >= 0 && pageIndex < doc.getPageCount()) {
        const p = doc.getPage(pageIndex)
        const view = getPageView(p)
        const { width, height } = viewSizePt(view)

        const regions: Rect[] = []
        for (const a of nativeAnns) {
          const fontSize = a.fontSize || 16
          const padX =
            a.maskPadX !== undefined ? a.maskPadX * width : Math.max(0.5, fontSize * 0.08)
          const padTop =
            a.maskPadTop !== undefined ? a.maskPadTop * height : Math.max(0.5, fontSize * 0.08)
          const padBottom =
            a.maskPadBottom !== undefined
              ? a.maskPadBottom * height
              : Math.max(0.7, fontSize * 0.12)

          const rectsToProcess =
            a.originalLineRects && a.originalLineRects.length > 0
              ? a.originalLineRects
              : [a.originalRect || { x: a.x, y: a.y, width: a.width, height: a.height }]

          for (const targetRect of rectsToProcess) {
            const u0 = (targetRect.x * width - padX) / width
            const u1 = ((targetRect.x + targetRect.width) * width + padX) / width
            const v0 = (targetRect.y * height - padTop) / height
            const v1 = ((targetRect.y + targetRect.height) * height + padBottom) / height

            const c1 = viewToPdf(view, u0, v0)
            const c2 = viewToPdf(view, u1, v0)
            const c3 = viewToPdf(view, u1, v1)
            const c4 = viewToPdf(view, u0, v1)

            const rectX = Math.min(c1.x, c2.x, c3.x, c4.x)
            const rectY = Math.min(c1.y, c2.y, c3.y, c4.y)
            const rectW = Math.max(c1.x, c2.x, c3.x, c4.x) - rectX
            const rectH = Math.max(c1.y, c2.y, c3.y, c4.y) - rectY

            regions.push({ x: rectX, y: rectY, width: rectW, height: rectH })
          }
        }

        const rep = removeTextInRegions(doc, pageIndex, regions)
        removalReports.set(pageNumber, rep)

        if (rep.keptIntersecting > 0) {
          warnings.push({
            page: pageNumber,
            reason: 'kept-intersecting',
            regionCount: rep.keptIntersecting,
          })
        }
        const totalSkipped = rep.skipped.reduce((acc, s) => acc + s.count, 0)
        if (totalSkipped > 0) {
          warnings.push({
            page: pageNumber,
            reason: 'skipped',
            regionCount: totalSkipped,
          })
        }
      }
    }
  }

  const pagesWithRemaining = pagesWithRemainingText(removalReports)
  const maskedPagesSet = new Set<number>()
  const cleanedPagesSet = new Set<number>()

  for (const pageNumber of editedPages) {
    const hasOcr = (pageOcrCounts.get(pageNumber) || 0) > 0
    const hasRemaining = pagesWithRemaining.includes(pageNumber)
    const isForced = forceMaskPages.includes(pageNumber)

    if (hasOcr || hasRemaining || isForced) {
      maskedPagesSet.add(pageNumber)
    } else {
      cleanedPagesSet.add(pageNumber)
    }
  }

  const maskedPages = Array.from(maskedPagesSet).sort((a, b) => a - b)
  const cleanedPages = Array.from(cleanedPagesSet).sort((a, b) => a - b)
  warnings.sort((a, b) => a.page - b.page)

  const fontCache = new Map<string, PDFFont>()

  const getFont = async (a: Annotation) => {
    const family = resolveExportFontFamily(a.fontFamily, a.text)
    const variant = `${a.bold ? 'bold' : ''}${a.italic ? 'italic' : ''}` || 'regular'
    const key = `${family}-${variant}`
    const cached = fontCache.get(key)
    if (cached) return { font: cached, family }

    if (family === 'Be Vietnam Pro' || family === 'Arimo' || family === 'Tinos') {
      let data: ArrayBuffer
      try {
        data = await loadFontBytes(family, variant)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`FONT_LOAD_FAILED: ${family} ${variant} - ${reason}`, { cause: err })
      }
      try {
        const embedded = await doc.embedFont(data, { subset: true })
        fontCache.set(key, embedded)
        return { font: embedded, family }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`FONT_LOAD_FAILED: Failed to embed ${family} ${variant} - ${reason}`, { cause: err })
      }
    }

    let name: StandardFonts
    if (family === 'Times Roman') {
      name = a.bold && a.italic ? StandardFonts.TimesRomanBoldItalic : a.bold ? StandardFonts.TimesRomanBold : a.italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
    } else if (family === 'Courier') {
      name = a.bold && a.italic ? StandardFonts.CourierBoldOblique : a.bold ? StandardFonts.CourierBold : a.italic ? StandardFonts.CourierOblique : StandardFonts.Courier
    } else {
      name = a.bold && a.italic ? StandardFonts.HelveticaBoldOblique : a.bold ? StandardFonts.HelveticaBold : a.italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica
    }
    const embedded = await doc.embedFont(name)
    fontCache.set(key, embedded)
    return { font: embedded, family }
  }

  for (const a of annotations) {
    const p = doc.getPage(a.page - 1)
    const view = getPageView(p)
    const { width, height } = viewSizePt(view)
    const textRgb = hexToRgb01(a.color || '#000000')
    const c = rgb(textRgb.r, textRgb.g, textRgb.b)
    const rotDegrees = view.rotation !== 0 ? degrees(view.rotation) : undefined

    if (a.type === 'text') {
      const { font, family } = await getFont(a)
      const boxWidth = a.width * width
      const fontSize = a.fontSize || 16
      const value = a.text || ''

      // TODO(verify): getCharacterSet() returns code points array for embedded fonts; standard fonts behavior is WinAnsi
      if (family === 'Be Vietnam Pro' || family === 'Arimo' || family === 'Tinos') {
        const charSet = new Set(font.getCharacterSet())
        const missingChars: string[] = []
        for (const char of Array.from(value)) {
          if (/\s/.test(char)) continue
          const cp = char.codePointAt(0)
          if (cp !== undefined && !charSet.has(cp)) {
            if (!missingChars.includes(char)) {
              missingChars.push(char)
              if (missingChars.length >= 10) break
            }
          }
        }
        if (missingChars.length > 0) {
          throw new Error(`MISSING_GLYPH: ${missingChars.join(', ')}`)
        }
      }

      if (a.replaceOriginal) {
        const shouldMask =
          a.originalSource === 'ocr' ||
          pagesWithRemaining.includes(a.page) ||
          forceMaskPages.includes(a.page)

        if (shouldMask) {
          const backgroundRgb01 = hexToRgb01(a.backgroundColor || '#ffffff')
          const backgroundRgb = rgb(backgroundRgb01.r, backgroundRgb01.g, backgroundRgb01.b)
          const padX = a.maskPadX !== undefined ? a.maskPadX * width : Math.max(0.5, fontSize * 0.08)
          const padTop = a.maskPadTop !== undefined ? a.maskPadTop * height : Math.max(0.5, fontSize * 0.08)
          const padBottom = a.maskPadBottom !== undefined ? a.maskPadBottom * height : Math.max(0.7, fontSize * 0.12)

          const u0 = (a.x * width - padX) / width
          const u1 = ((a.x + a.width) * width + padX) / width
          const v0 = (a.y * height - padTop) / height
          const v1 = ((a.y + a.height) * height + padBottom) / height

          const c1 = viewToPdf(view, u0, v0)
          const c2 = viewToPdf(view, u1, v0)
          const c3 = viewToPdf(view, u1, v1)
          const c4 = viewToPdf(view, u0, v1)

          const rectX = Math.min(c1.x, c2.x, c3.x, c4.x)
          const rectY = Math.min(c1.y, c2.y, c3.y, c4.y)
          const rectW = Math.max(c1.x, c2.x, c3.x, c4.x) - rectX
          const rectH = Math.max(c1.y, c2.y, c3.y, c4.y) - rectY

          p.drawRectangle({
            x: rectX,
            y: rectY,
            width: rectW,
            height: rectH,
            color: backgroundRgb,
            opacity: 1,
          })
        }

        const lineHeightPt = a.lineHeight ?? fontSize * 1.2
        const lines = wrapTextToWidth(value, boxWidth, (s) => font.widthOfTextAtSize(s, fontSize))

        if (lines.length * lineHeightPt > a.height * height + 0.5 * lineHeightPt) {
          overflowPagesSet.add(a.page)
        }

        if (lines.length <= 1) {
          if (value) {
            const textWidth = font.widthOfTextAtSize(value, fontSize)
            const alignOffset =
              a.align === 'center'
                ? Math.max(0, (boxWidth - textWidth) / 2)
                : a.align === 'right'
                  ? Math.max(0, boxWidth - textWidth)
                  : 0
            const uText = (a.x * width + alignOffset) / width
            const vText = (a.y * height + fontSize) / height
            const textPos = viewToPdf(view, uText, vText)

            p.drawText(value, {
              x: textPos.x,
              y: textPos.y,
              size: fontSize,
              font,
              color: c,
              opacity: a.opacity,
              maxWidth: boxWidth,
              rotate: rotDegrees,
            })

            if (a.underline) {
              const uLineStart = (a.x * width + alignOffset) / width
              const uLineEnd = Math.min(a.x * width + alignOffset + textWidth, a.x * width + boxWidth) / width
              const vLine = (a.y * height + fontSize + 1.5) / height

              const lineStart = viewToPdf(view, uLineStart, vLine)
              const lineEnd = viewToPdf(view, uLineEnd, vLine)

              p.drawLine({
                start: lineStart,
                end: lineEnd,
                color: c,
                thickness: Math.max(0.6, fontSize / 18),
                opacity: a.opacity,
              })
            }
          }
        } else {
          for (let i = 0; i < lines.length; i++) {
            const lineStr = lines[i]
            if (!lineStr) continue
            const lineTextWidth = font.widthOfTextAtSize(lineStr, fontSize)
            const lineAlignOffset =
              a.align === 'center'
                ? Math.max(0, (boxWidth - lineTextWidth) / 2)
                : a.align === 'right'
                  ? Math.max(0, boxWidth - lineTextWidth)
                  : 0

            const u = (a.x * width + lineAlignOffset) / width
            const v = (a.y * height + fontSize + i * lineHeightPt) / height
            const pos = viewToPdf(view, u, v)

            p.drawText(lineStr, {
              x: pos.x,
              y: pos.y,
              size: fontSize,
              font,
              color: c,
              opacity: a.opacity,
              rotate: rotDegrees,
            })

            if (a.underline) {
              const uLineStart = (a.x * width + lineAlignOffset) / width
              const uLineEnd = Math.min(
                a.x * width + lineAlignOffset + lineTextWidth,
                a.x * width + boxWidth,
              ) / width
              const vLine = (a.y * height + fontSize + i * lineHeightPt + 1.5) / height

              const lineStart = viewToPdf(view, uLineStart, vLine)
              const lineEnd = viewToPdf(view, uLineEnd, vLine)

              p.drawLine({
                start: lineStart,
                end: lineEnd,
                color: c,
                thickness: Math.max(0.6, fontSize / 18),
                opacity: a.opacity,
              })
            }
          }
        }
      } else {
        const textWidth = font.widthOfTextAtSize(value, fontSize)
        const alignOffset =
          a.align === 'center'
            ? Math.max(0, (boxWidth - textWidth) / 2)
            : a.align === 'right'
              ? Math.max(0, boxWidth - textWidth)
              : 0

        if (value) {
          const uText = (a.x * width + alignOffset) / width
          const vText = (a.y * height + fontSize) / height
          const textPos = viewToPdf(view, uText, vText)

          p.drawText(value, {
            x: textPos.x,
            y: textPos.y,
            size: fontSize,
            font,
            color: c,
            opacity: a.opacity,
            maxWidth: boxWidth,
            rotate: rotDegrees,
          })

          if (a.underline) {
            const uLineStart = (a.x * width + alignOffset) / width
            const uLineEnd = Math.min(a.x * width + alignOffset + textWidth, a.x * width + boxWidth) / width
            const vLine = (a.y * height + fontSize + 1.5) / height

            const lineStart = viewToPdf(view, uLineStart, vLine)
            const lineEnd = viewToPdf(view, uLineEnd, vLine)

            p.drawLine({
              start: lineStart,
              end: lineEnd,
              color: c,
              thickness: Math.max(0.6, fontSize / 18),
              opacity: a.opacity,
            })
          }
        }
      }
    } else if (a.type === 'image' && a.imageDataUrl) {
      const data = await loadImageBytes(a.imageDataUrl)
      const embedded = a.imageDataUrl.startsWith('data:image/png') ? await doc.embedPng(data) : await doc.embedJpg(data)
      const origin = viewToPdf(view, a.x, a.y + a.height)
      p.drawImage(embedded, {
        x: origin.x,
        y: origin.y,
        width: a.width * width,
        height: a.height * height,
        opacity: a.opacity,
        rotate: rotDegrees,
      })
    } else if (a.type === 'highlight') {
      const c1 = viewToPdf(view, a.x, a.y)
      const c2 = viewToPdf(view, a.x + a.width, a.y)
      const c3 = viewToPdf(view, a.x + a.width, a.y + a.height)
      const c4 = viewToPdf(view, a.x, a.y + a.height)

      const rectX = Math.min(c1.x, c2.x, c3.x, c4.x)
      const rectY = Math.min(c1.y, c2.y, c3.y, c4.y)
      const rectW = Math.max(c1.x, c2.x, c3.x, c4.x) - rectX
      const rectH = Math.max(c1.y, c2.y, c3.y, c4.y) - rectY

      p.drawRectangle({
        x: rectX,
        y: rectY,
        width: rectW,
        height: rectH,
        color: c,
        opacity: a.opacity,
        blendMode: BlendMode.Multiply,
      })
    } else if (a.points && a.points.length > 1) {
      for (let i = 1; i < a.points.length; i++) {
        const start = viewToPdf(view, a.points[i - 1].x, a.points[i - 1].y)
        const end = viewToPdf(view, a.points[i].x, a.points[i].y)
        p.drawLine({
          start,
          end,
          color: c,
          thickness: a.type === 'signature' ? 2.2 : 1.8,
          opacity: a.opacity,
        })
      }
    }
  }

  const outBytes = new Uint8Array(await doc.save())
  return {
    bytes: outBytes,
    report: {
      editedPages,
      cleanedPages,
      maskedPages,
      warnings,
      overflowPages: Array.from(overflowPagesSet).sort((a, b) => a - b),
    },
  }
}

export async function buildEditedPdf(
  bytes: Uint8Array,
  annotations: Annotation[],
  options?: BuildPdfOptions,
): Promise<Uint8Array> {
  const result = await buildEditedPdfWithReport(bytes, annotations, options)
  return result.bytes
}
