export type Tool = 'select' | 'text' | 'highlight' | 'draw' | 'signature'

export type Point = { x: number; y: number }

export type Annotation = {
  id: string
  page: number
  type: Exclude<Tool, 'select'>
  x: number
  y: number
  width: number
  height: number
  color: string
  opacity: number
  text?: string
  fontSize?: number
  points?: Point[]
}

export type DocumentInfo = {
  name: string
  size: number
  pages: number
}
