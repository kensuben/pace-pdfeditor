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
