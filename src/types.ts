export type Tool = 'select' | 'text' | 'highlight' | 'draw' | 'signature'

export type Point = { x: number; y: number }

export type PageImageRegion = {
  id: string
  page: number
  x: number
  y: number
  width: number
  height: number
  resourceName: string
  occurrence: number
  editable: boolean
}

export type TextRegion = {
  id: string
  page: number
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontFamily?: 'Helvetica' | 'Times Roman' | 'Courier' | 'Be Vietnam Pro' | 'Arimo' | 'Noto Sans'
  bold?: boolean
  italic?: boolean
  color?: string
  align?: 'left' | 'center' | 'right'
  backgroundColor?: string
  maskPadX?: number
  maskPadTop?: number
  maskPadBottom?: number
  confidence?: number
  source: 'native' | 'ocr'
  rotation?: number
  lineHeight?: number
  lineRects?: Array<{ x: number; y: number; width: number; height: number }>
}

export type Annotation = {
  id: string
  page: number
  type: Exclude<Tool, 'select'> | 'image'
  x: number
  y: number
  width: number
  height: number
  color: string
  opacity: number
  text?: string
  fontSize?: number
  points?: Point[]
  replaceOriginal?: boolean
  fontFamily?: 'Helvetica' | 'Times Roman' | 'Courier' | 'Be Vietnam Pro' | 'Arimo' | 'Noto Sans'
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: 'left' | 'center' | 'right'
  imageDataUrl?: string
  backgroundColor?: string
  maskPadX?: number
  maskPadTop?: number
  maskPadBottom?: number
  originalText?: string
  originalSource?: 'native' | 'ocr'
  originalRect?: { x: number; y: number; width: number; height: number }
  lineHeight?: number
  originalLineRects?: Array<{ x: number; y: number; width: number; height: number }>
  maxWidth?: number
  sourceImage?: {
    resourceName: string
    occurrence: number
    originalRect: { x: number; y: number; width: number; height: number }
  }
  deleted?: boolean
  imageRotation?: 0 | 90 | 180 | 270
  flipH?: boolean
  flipV?: boolean
  replacementDataUrl?: string
  imageCrop?: { left: number; top: number; right: number; bottom: number }
  pageLayer?: 'original' | 'top' | 'bottom'
}

export type TextStyle = Pick<Annotation, 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'align' | 'color'>

export type DocumentInfo = {
  name: string
  size: number
  pages: number
}
