export type Tool = 'select' | 'text' | 'highlight' | 'draw' | 'signature'

export type Point = { x: number; y: number }

export type TextRegion = {
  id: string
  page: number
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontFamily?: 'Helvetica' | 'Times Roman' | 'Courier'
  bold?: boolean
  italic?: boolean
  color?: string
  align?: 'left' | 'center' | 'right'
  confidence?: number
  source: 'native' | 'ocr'
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
  fontFamily?: 'Helvetica' | 'Times Roman' | 'Courier'
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: 'left' | 'center' | 'right'
  imageDataUrl?: string
}

export type TextStyle = Pick<Annotation, 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'align' | 'color'>

export type DocumentInfo = {
  name: string
  size: number
  pages: number
}
