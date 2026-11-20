import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import beRegular from '@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-400-normal.woff?url'
import beItalic from '@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-400-italic.woff?url'
import beBold from '@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-700-normal.woff?url'
import beBoldItalic from '@fontsource/be-vietnam-pro/files/be-vietnam-pro-vietnamese-700-italic.woff?url'
import arimoRegular from '@fontsource/arimo/files/arimo-vietnamese-400-normal.woff?url'
import arimoItalic from '@fontsource/arimo/files/arimo-vietnamese-400-italic.woff?url'
import arimoBold from '@fontsource/arimo/files/arimo-vietnamese-700-normal.woff?url'
import arimoBoldItalic from '@fontsource/arimo/files/arimo-vietnamese-700-italic.woff?url'
import notoRegular from '@fontsource/noto-sans/files/noto-sans-vietnamese-400-normal.woff?url'
import notoItalic from '@fontsource/noto-sans/files/noto-sans-vietnamese-400-italic.woff?url'
import notoBold from '@fontsource/noto-sans/files/noto-sans-vietnamese-700-normal.woff?url'
import notoBoldItalic from '@fontsource/noto-sans/files/noto-sans-vietnamese-700-italic.woff?url'
import type { Annotation } from '../types'
import { hexToRgb01 } from './geometry'

export interface BuildPdfOptions {
  loadFontBytes?: (family: string, variant: string) => Promise<ArrayBuffer>
  loadImageBytes?: (dataUrl: string) => Promise<ArrayBuffer>
}

const customFonts: Record<string, Record<string, string>> = {
  'Be Vietnam Pro': { regular: beRegular, italic: beItalic, bold: beBold, bolditalic: beBoldItalic },
  Arimo: { regular: arimoRegular, italic: arimoItalic, bold: arimoBold, bolditalic: arimoBoldItalic },
  'Noto Sans': { regular: notoRegular, italic: notoItalic, bold: notoBold, bolditalic: notoBoldItalic },
}

const defaultLoadFontBytes = async (family: string, variant: string): Promise<ArrayBuffer> => {
  const fontUrl = customFonts[family]?.[variant]
  if (!fontUrl) throw new Error(`Font url not found for ${family} ${variant}`)
  const response = await fetch(fontUrl)
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
    const requestedFamily = a.fontFamily || 'Helvetica'
    const hasUnicode = Array.from(a.text || '').some((character) => (character.codePointAt(0) || 0) > 127)
    const family = hasUnicode && ['Helvetica', 'Times Roman', 'Courier'].includes(requestedFamily) ? 'Noto Sans' : requestedFamily
    const variant = `${a.bold ? 'bold' : ''}${a.italic ? 'italic' : ''}` || 'regular'
    const key = `${family}-${variant}`
    const cached = fontCache.get(key)
    if (cached) return cached

    if (customFonts[family] || options?.loadFontBytes) {
      try {
        const data = await loadFontBytes(family, variant)
        const embedded = await doc.embedFont(data, { subset: true })
        fontCache.set(key, embedded)
        return embedded
      } catch (err) {
        if (!customFonts[family]) throw err
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
    return embedded
  }

  for (const a of annotations) {
    const p = doc.getPage(a.page - 1)
    const { width, height } = p.getSize()
    const textRgb = hexToRgb01(a.color)
    const c = rgb(textRgb.r, textRgb.g, textRgb.b)

    if (a.type === 'text') {
      const font = await getFont(a)
      const boxWidth = a.width * width
      let fontSize = a.fontSize || 16
      const value = a.text || ''
      const naturalWidth = font.widthOfTextAtSize(value, fontSize)
      if (a.replaceOriginal && naturalWidth > boxWidth) fontSize = Math.max(6, fontSize * (boxWidth / naturalWidth))
      const textWidth = font.widthOfTextAtSize(value, fontSize)
      const textX = a.x * width + (a.align === 'center' ? Math.max(0, (boxWidth - textWidth) / 2) : a.align === 'right' ? Math.max(0, boxWidth - textWidth) : 0)
      const textY = height - (a.y * height) - fontSize
      if (a.replaceOriginal) {
        const backgroundRgb01 = hexToRgb01(a.backgroundColor || '#ffffff')
        const backgroundRgb = rgb(backgroundRgb01.r, backgroundRgb01.g, backgroundRgb01.b)
        const padX = a.maskPadX !== undefined ? a.maskPadX * width : Math.max(0.5, fontSize * 0.08)
        const padTop = a.maskPadTop !== undefined ? a.maskPadTop * height : Math.max(0.5, fontSize * 0.08)
        const padBottom = a.maskPadBottom !== undefined ? a.maskPadBottom * height : Math.max(0.7, fontSize * 0.12)
        p.drawRectangle({
          x: a.x * width - padX,
          y: height - (a.y + a.height) * height - padBottom,
          width: a.width * width + padX * 2,
          height: a.height * height + padTop + padBottom,
          color: backgroundRgb,
          opacity: 1,
        })
      }
      if (value) {
        p.drawText(value, { x: textX, y: textY, size: fontSize, font, color: c, opacity: a.opacity, maxWidth: boxWidth })
        if (a.underline) {
          p.drawLine({
            start: { x: textX, y: textY - 1.5 },
            end: { x: Math.min(textX + textWidth, a.x * width + boxWidth), y: textY - 1.5 },
            color: c,
            thickness: Math.max(0.6, fontSize / 18),
            opacity: a.opacity,
          })
        }
      }
    } else if (a.type === 'image' && a.imageDataUrl) {
      const data = await loadImageBytes(a.imageDataUrl)
      const embedded = a.imageDataUrl.startsWith('data:image/png') ? await doc.embedPng(data) : await doc.embedJpg(data)
      p.drawImage(embedded, {
        x: a.x * width,
        y: height - (a.y + a.height) * height,
        width: a.width * width,
        height: a.height * height,
        opacity: a.opacity,
      })
    } else if (a.type === 'highlight') {
      p.drawRectangle({
        x: a.x * width,
        y: height - (a.y + a.height) * height,
        width: a.width * width,
        height: a.height * height,
        color: c,
        opacity: a.opacity,
      })
    } else if (a.points && a.points.length > 1) {
      for (let i = 1; i < a.points.length; i++) {
        p.drawLine({
          start: { x: a.points[i - 1].x * width, y: height - a.points[i - 1].y * height },
          end: { x: a.points[i].x * width, y: height - a.points[i].y * height },
          color: c,
          thickness: a.type === 'signature' ? 2.2 : 1.8,
          opacity: a.opacity,
        })
      }
    }
  }

  return new Uint8Array(await doc.save())
}
