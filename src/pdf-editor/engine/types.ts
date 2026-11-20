export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Operand =
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'string'; bytes: Uint8Array; isHex?: boolean }
  | { type: 'array'; value: Operand[] }
  | { type: 'dict'; value: Record<string, Operand> }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'inline-image'; bytes: Uint8Array }

export interface ContentOp {
  operator: string
  operands: Operand[]
}

export type SkipReason =
  | 'form-xobject'
  | 'type3-font'
  | 'approximate-width'
  | 'decode-error'
  | 'zero-scale'

export interface SkipRecord {
  reason: SkipReason
  count: number
}

export interface RemovalReport {
  removedOps: number
  partialOps: number
  skipped: SkipRecord[]
  approximateOps: number
  keptIntersecting: number
}

export interface TextShowInfo {
  opIndex: number
  bbox: Rect
  fontResourceName: string
  approximate: boolean
  elements?: Array<{
    index: number
    bbox: Rect
    isString: boolean
    widthInEm: number
  }>
}
