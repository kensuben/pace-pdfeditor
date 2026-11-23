export const EXPORT_FONT_FILES: Record<
  'Be Vietnam Pro' | 'Arimo',
  Record<'regular' | 'italic' | 'bold' | 'bolditalic', string>
> = {
  'Be Vietnam Pro': {
    regular: 'BeVietnamPro-Regular.ttf',
    italic: 'BeVietnamPro-Italic.ttf',
    bold: 'BeVietnamPro-Bold.ttf',
    bolditalic: 'BeVietnamPro-BoldItalic.ttf',
  },
  Arimo: {
    regular: 'Arimo-Regular.ttf',
    italic: 'Arimo-Italic.ttf',
    bold: 'Arimo-Bold.ttf',
    bolditalic: 'Arimo-BoldItalic.ttf',
  },
}

export function resolveExportFontFamily(
  requested?: string,
  text?: string,
): 'Be Vietnam Pro' | 'Arimo' | 'Helvetica' | 'Times Roman' | 'Courier' {
  if (requested === 'Be Vietnam Pro') return 'Be Vietnam Pro'
  if (requested === 'Arimo') return 'Arimo'
  if (requested === 'Noto Sans') return 'Arimo'

  const effective = requested || 'Helvetica'
  const hasUnicode = Array.from(text || '').some((char) => (char.codePointAt(0) || 0) > 127)

  if (effective === 'Times Roman') return hasUnicode ? 'Arimo' : 'Times Roman'
  if (effective === 'Courier') return hasUnicode ? 'Arimo' : 'Courier'
  if (effective === 'Helvetica') return hasUnicode ? 'Arimo' : 'Helvetica'

  return hasUnicode ? 'Arimo' : 'Helvetica'
}

export function styleFromBaseFont(name?: string): {
  family: 'Helvetica' | 'Times Roman' | 'Courier'
  bold: boolean
  italic: boolean
} {
  const raw = name || ''
  const clean = raw.replace(/^[A-Z]{6}\+/, '')
  const l = clean.toLowerCase()
  let family: 'Helvetica' | 'Times Roman' | 'Courier' = 'Helvetica'
  if (/courier|mono|consolas/.test(l)) {
    family = 'Courier'
  } else if (/times|georgia|garamond|cambria/.test(l)) {
    family = 'Times Roman'
  } else if (/serif/.test(l) && !/sans/.test(l)) {
    family = 'Times Roman'
  }
  const bold = /bold|black|heavy|semibold|demi/i.test(clean)
  const italic = /italic|oblique/i.test(clean)
  return { family, bold, italic }
}

export function cssFontStack(family?: string): string {
  switch (family) {
    case 'Times Roman':
      return '"Times New Roman", Times, "Liberation Serif", serif'
    case 'Courier':
      return '"Courier New", Courier, "Liberation Mono", monospace'
    case 'Arimo':
      return 'Arimo, Arial, sans-serif'
    case 'Be Vietnam Pro':
      return '"Be Vietnam Pro", sans-serif'
    case 'Noto Sans':
      return '"Noto Sans", sans-serif'
    case 'Helvetica':
    default:
      return 'Helvetica, Arimo, Arial, sans-serif'
  }
}

