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
import type { Annotation } from '../types'
import { hexToRgb01 } from './geometry'
import { resolveExportFontFamily } from './fonts'
import { getPageView, viewSizePt, viewToPdf } from './pageGeometry'

export interface BuildPdfOptions {
  loadFontBytes?: (family: string, variant: string) => Promise<ArrayBuffer>
  loadImageBytes?: (dataUrl: string) => Promise<ArrayBuffer>
}

const exportFontUrls: Record<'Be Vietnam Pro' | 'Arimo', Record<'regular' | 'italic' | 'bold' | 'bolditalic', string>> = {
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

export async function buildEditedPdf(
  bytes: Uint8Array,
  annotations: Annotation[],
  options?: BuildPdfOptions,
): Promise<Uint8Array> {
  const loadFontBytes = options?.loadFontBytes || defaultLoadFontBytes
  const loadImageBytes = options?.loadImageBytes || defaultLoadImageBytes

  const doc = await PDFDocument.load(bytes)
  doc.registerFontkit(fontkit)
  const fontCache = new Map<string, PDFFont>()

  const getFont = async (a: Annotation) => {
    const family = resolveExportFontFamily(a.fontFamily, a.text)
    const variant = `${a.bold ? 'bold' : ''}${a.italic ? 'italic' : ''}` || 'regular'
    const key = `${family}-${variant}`
    const cached = fontCache.get(key)
    if (cached) return { font: cached, family }

    if (family === 'Be Vietnam Pro' || family === 'Arimo') {
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
    const textRgb = hexToRgb01(a.color)
    const c = rgb(textRgb.r, textRgb.g, textRgb.b)
    const rotDegrees = view.rotation !== 0 ? degrees(view.rotation) : undefined

    if (a.type === 'text') {
      const { font, family } = await getFont(a)
      const boxWidth = a.width * width
      let fontSize = a.fontSize || 16
      const value = a.text || ''

      // TODO(verify): getCharacterSet() returns code points array for embedded fonts; standard fonts behavior is WinAnsi
      if (family === 'Be Vietnam Pro' || family === 'Arimo') {
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

      const naturalWidth = font.widthOfTextAtSize(value, fontSize)
      if (a.replaceOriginal && naturalWidth > boxWidth) fontSize = Math.max(6, fontSize * (boxWidth / naturalWidth))
      const textWidth = font.widthOfTextAtSize(value, fontSize)
      const alignOffset = a.align === 'center' ? Math.max(0, (boxWidth - textWidth) / 2) : a.align === 'right' ? Math.max(0, boxWidth - textWidth) : 0

      if (a.replaceOriginal) {
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

  return new Uint8Array(await doc.save())
}
