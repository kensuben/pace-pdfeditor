import type { ContentOp, Operand } from './types'

export class ContentSyntaxError extends Error {
  public position: number

  constructor(message: string, position: number) {
    super(`${message} at byte ${position}`)
    this.name = 'ContentSyntaxError'
    this.position = position
  }
}

function isWhitespace(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c || b === 0x00
}

function isDelimiter(b: number): boolean {
  return (
    b === 0x28 || // (
    b === 0x29 || // )
    b === 0x3c || // <
    b === 0x3e || // >
    b === 0x5b || // [
    b === 0x5d || // ]
    b === 0x7b || // {
    b === 0x7d || // }
    b === 0x2f || // /
    b === 0x25    // %
  )
}

function isNumberToken(s: string): boolean {
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)
}

export function tokenizeContent(bytes: Uint8Array): ContentOp[] {
  let pos = 0
  const len = bytes.length
  const ops: ContentOp[] = []
  let currentOperands: Operand[] = []

  function skipWhitespaceAndComments(): void {
    while (pos < len) {
      const b = bytes[pos]
      if (isWhitespace(b)) {
        pos++
      } else if (b === 0x25) {
        // '%' comment -> skip until \r or \n or EOF
        pos++
        while (pos < len && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) {
          pos++
        }
      } else {
        break
      }
    }
  }

  function readRegularToken(): string {
    const start = pos
    while (pos < len && !isWhitespace(bytes[pos]) && !isDelimiter(bytes[pos])) {
      pos++
    }
    let token = ''
    for (let i = start; i < pos; i++) {
      token += String.fromCharCode(bytes[i])
    }
    return token
  }

  function readLiteralString(): Operand {
    const startPos = pos
    pos++ // skip '('
    const result: number[] = []
    let depth = 1

    while (pos < len) {
      const b = bytes[pos]
      if (b === 0x5c) {
        // '\\' escape
        pos++
        if (pos >= len) {
          throw new ContentSyntaxError('Unclosed literal string (trailing backslash)', startPos)
        }
        const esc = bytes[pos]
        if (esc === 0x6e) {
          result.push(0x0a)
          pos++
        } else if (esc === 0x72) {
          result.push(0x0d)
          pos++
        } else if (esc === 0x74) {
          result.push(0x09)
          pos++
        } else if (esc === 0x62) {
          result.push(0x08)
          pos++
        } else if (esc === 0x66) {
          result.push(0x0c)
          pos++
        } else if (esc === 0x28) {
          result.push(0x28)
          pos++
        } else if (esc === 0x29) {
          result.push(0x29)
          pos++
        } else if (esc === 0x5c) {
          result.push(0x5c)
          pos++
        } else if (esc >= 0x30 && esc <= 0x37) {
          // octal \ddd (1-3 octal digits)
          let octalStr = String.fromCharCode(esc)
          pos++
          if (pos < len && bytes[pos] >= 0x30 && bytes[pos] <= 0x37) {
            octalStr += String.fromCharCode(bytes[pos])
            pos++
            if (pos < len && bytes[pos] >= 0x30 && bytes[pos] <= 0x37) {
              octalStr += String.fromCharCode(bytes[pos])
              pos++
            }
          }
          result.push(parseInt(octalStr, 8) & 0xff)
        } else if (esc === 0x0d) {
          // line break continuation: \ followed by \r or \r\n
          pos++
          if (pos < len && bytes[pos] === 0x0a) pos++
        } else if (esc === 0x0a) {
          // line break continuation: \ followed by \n
          pos++
        } else {
          result.push(esc)
          pos++
        }
      } else if (b === 0x28) {
        // nested '('
        depth++
        result.push(b)
        pos++
      } else if (b === 0x29) {
        // ')'
        depth--
        if (depth === 0) {
          pos++
          return { type: 'string', bytes: new Uint8Array(result), isHex: false }
        }
        result.push(b)
        pos++
      } else if (b === 0x0d) {
        // end of line in literal string: \r or \r\n normalized to \n (ISO 32000-1 7.3.4.2)
        pos++
        if (pos < len && bytes[pos] === 0x0a) pos++
        result.push(0x0a)
      } else {
        result.push(b)
        pos++
      }
    }

    throw new ContentSyntaxError('Unclosed literal string', startPos)
  }

  function readHexString(): Operand {
    const startPos = pos
    pos++ // skip '<'
    const hexChars: string[] = []

    while (pos < len) {
      const b = bytes[pos]
      if (b === 0x3e) {
        // '>'
        pos++
        if (hexChars.length % 2 === 1) {
          hexChars.push('0') // odd number of hex digits implicitly padded with 0
        }
        const out = new Uint8Array(hexChars.length / 2)
        for (let i = 0; i < out.length; i++) {
          out[i] = parseInt(hexChars[i * 2] + hexChars[i * 2 + 1], 16)
        }
        return { type: 'string', bytes: out, isHex: true }
      }
      if (isWhitespace(b)) {
        pos++
        continue
      }
      if (
        (b >= 0x30 && b <= 0x39) ||
        (b >= 0x41 && b <= 0x46) ||
        (b >= 0x61 && b <= 0x66)
      ) {
        hexChars.push(String.fromCharCode(b))
        pos++
      } else {
        throw new ContentSyntaxError(`Invalid character '${String.fromCharCode(b)}' in hex string`, pos)
      }
    }

    throw new ContentSyntaxError('Unclosed hex string', startPos)
  }

  function readName(): { type: 'name'; value: string } {
    pos++ // skip '/'
    let nameStr = '/'
    while (pos < len) {
      const b = bytes[pos]
      if (isWhitespace(b) || isDelimiter(b)) break
      if (b === 0x23) {
        // '#' hex escape: #xx
        if (pos + 2 < len) {
          const hex = String.fromCharCode(bytes[pos + 1], bytes[pos + 2])
          if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
            nameStr += String.fromCharCode(parseInt(hex, 16))
            pos += 3
            continue
          }
        }
      }
      nameStr += String.fromCharCode(b)
      pos++
    }
    return { type: 'name', value: nameStr }
  }

  function readArray(): Operand {
    const startPos = pos
    pos++ // skip '['
    const arr: Operand[] = []

    while (pos < len) {
      skipWhitespaceAndComments()
      if (pos >= len) break
      if (bytes[pos] === 0x5d) {
        // ']'
        pos++
        return { type: 'array', value: arr }
      }
      arr.push(readOperandInsideCollection(startPos))
    }

    throw new ContentSyntaxError('Unclosed array', startPos)
  }

  function readDict(): Operand {
    const startPos = pos
    pos += 2 // skip '<<'
    const dict: Record<string, Operand> = {}

    while (pos < len) {
      skipWhitespaceAndComments()
      if (pos >= len) break
      if (bytes[pos] === 0x3e && pos + 1 < len && bytes[pos + 1] === 0x3e) {
        // '>>'
        pos += 2
        return { type: 'dict', value: dict }
      }
      if (bytes[pos] !== 0x2f) {
        throw new ContentSyntaxError('Dictionary key must be a Name', pos)
      }
      const keyOperand = readName()
      skipWhitespaceAndComments()
      if (pos >= len) break
      const valOperand = readOperandInsideCollection(startPos)
      const rawKey = keyOperand.value.startsWith('/') ? keyOperand.value.slice(1) : keyOperand.value
      dict[rawKey] = valOperand
    }

    throw new ContentSyntaxError('Unclosed dictionary', startPos)
  }

  function readOperandInsideCollection(parentStartPos: number): Operand {
    skipWhitespaceAndComments()
    if (pos >= len) {
      throw new ContentSyntaxError('Unexpected end of input in collection', parentStartPos)
    }
    const b = bytes[pos]
    if (b === 0x28) return readLiteralString()
    if (b === 0x3c) {
      if (pos + 1 < len && bytes[pos + 1] === 0x3c) return readDict()
      return readHexString()
    }
    if (b === 0x5b) return readArray()
    if (b === 0x2f) return readName()
    if (b === 0x5d || b === 0x3e) {
      throw new ContentSyntaxError(`Unexpected delimiter '${String.fromCharCode(b)}'`, pos)
    }

    const token = readRegularToken()
    if (token === 'true') return { type: 'boolean', value: true }
    if (token === 'false') return { type: 'boolean', value: false }
    if (token === 'null') return { type: 'null' }
    if (isNumberToken(token)) return { type: 'number', value: parseFloat(token) }

    throw new ContentSyntaxError(`Invalid operand '${token}' in collection`, pos)
  }

  function readInlineImage(startPos: number): Uint8Array {
    // Scan until ID operator
    const idIndex = findToken('ID', pos)
    if (idIndex === -1) {
      throw new ContentSyntaxError('Inline image missing ID operator', startPos)
    }
    pos = idIndex + 2
    // Skip single whitespace after ID (ISO 32000-1 8.9.7)
    if (pos < len && isWhitespace(bytes[pos])) {
      if (bytes[pos] === 0x0d && pos + 1 < len && bytes[pos + 1] === 0x0a) {
        pos += 2
      } else {
        pos++
      }
    }
    // Scan until whitespace followed by EI
    while (pos < len) {
      if (isWhitespace(bytes[pos])) {
        let p = pos + 1
        while (p < len && isWhitespace(bytes[p])) p++
        if (p + 1 < len && bytes[p] === 0x45 && bytes[p + 1] === 0x49) { // 'EI'
          const afterEI = p + 2
          if (afterEI >= len || isWhitespace(bytes[afterEI]) || isDelimiter(bytes[afterEI])) {
            pos = afterEI
            return bytes.subarray(startPos, pos)
          }
        }
      }
      pos++
    }
    throw new ContentSyntaxError('Inline image missing EI operator', startPos)
  }

  function findToken(tok: string, startFrom: number): number {
    const t0 = tok.charCodeAt(0)
    const t1 = tok.charCodeAt(1)
    for (let i = startFrom; i < len - 1; i++) {
      if (bytes[i] === t0 && bytes[i + 1] === t1) {
        // verify delimiter or whitespace before and after
        const before = i === 0 || isWhitespace(bytes[i - 1]) || isDelimiter(bytes[i - 1])
        const after = i + 2 >= len || isWhitespace(bytes[i + 2]) || isDelimiter(bytes[i + 2])
        if (before && after) return i
      }
    }
    return -1
  }

  while (pos < len) {
    skipWhitespaceAndComments()
    if (pos >= len) break

    const b = bytes[pos]

    if (b === 0x28) {
      currentOperands.push(readLiteralString())
      continue
    }

    if (b === 0x3c) {
      if (pos + 1 < len && bytes[pos + 1] === 0x3c) {
        currentOperands.push(readDict())
      } else {
        currentOperands.push(readHexString())
      }
      continue
    }

    if (b === 0x5b) {
      currentOperands.push(readArray())
      continue
    }

    if (b === 0x2f) {
      currentOperands.push(readName())
      continue
    }

    if (b === 0x29 || b === 0x3e || b === 0x5d || b === 0x7d) {
      throw new ContentSyntaxError(`Unexpected delimiter '${String.fromCharCode(b)}'`, pos)
    }

    const start = pos
    const token = readRegularToken()

    if (token === 'BI') {
      const inlineBytes = readInlineImage(start)
      ops.push({
        operator: 'BI',
        operands: [{ type: 'inline-image', bytes: inlineBytes }],
      })
      continue
    }

    if (token === 'true') {
      currentOperands.push({ type: 'boolean', value: true })
    } else if (token === 'false') {
      currentOperands.push({ type: 'boolean', value: false })
    } else if (token === 'null') {
      currentOperands.push({ type: 'null' })
    } else if (isNumberToken(token)) {
      currentOperands.push({ type: 'number', value: parseFloat(token) })
    } else {
      // Operator encountered
      ops.push({
        operator: token,
        operands: currentOperands,
      })
      currentOperands = []
    }
  }

  if (currentOperands.length > 0) {
    throw new ContentSyntaxError(`Trailing operands without operator (${currentOperands.length} items)`, pos)
  }

  return ops
}

function escapeName(name: string): string {
  let out = ''
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code < 33 || code > 126 || isDelimiter(code) || code === 0x23) {
      out += '#' + code.toString(16).toUpperCase().padStart(2, '0')
    } else {
      out += name[i]
    }
  }
  return out
}

function serializeOperand(op: Operand): string {
  switch (op.type) {
    case 'number': {
      if (Number.isInteger(op.value)) return op.value.toString()
      const formatted = op.value.toFixed(6).replace(/\.?0+$/, '')
      return formatted === '-0' ? '0' : formatted
    }
    case 'name': {
      const bare = op.value.startsWith('/') ? op.value.slice(1) : op.value
      return '/' + escapeName(bare)
    }
    case 'boolean':
      return op.value ? 'true' : 'false'
    case 'null':
      return 'null'
    case 'string': {
      if (op.isHex) {
        let hex = ''
        for (let i = 0; i < op.bytes.length; i++) {
          hex += op.bytes[i].toString(16).toUpperCase().padStart(2, '0')
        }
        return '<' + hex + '>'
      }
      let lit = '('
      for (let i = 0; i < op.bytes.length; i++) {
        const b = op.bytes[i]
        if (b === 0x28) lit += '\\('
        else if (b === 0x29) lit += '\\)'
        else if (b === 0x5c) lit += '\\\\'
        else if (b === 0x0a) lit += '\\n'
        else if (b === 0x0d) lit += '\\r'
        else if (b === 0x09) lit += '\\t'
        else if (b === 0x08) lit += '\\b'
        else if (b === 0x0c) lit += '\\f'
        else if (b >= 32 && b <= 126) lit += String.fromCharCode(b)
        else lit += '\\' + b.toString(8).padStart(3, '0')
      }
      lit += ')'
      return lit
    }
    case 'array':
      return '[' + op.value.map(serializeOperand).join(' ') + ']'
    case 'dict': {
      const entries = Object.entries(op.value).map(([k, v]) => '/' + escapeName(k) + ' ' + serializeOperand(v))
      return '<< ' + entries.join(' ') + ' >>'
    }
    case 'inline-image':
      return ''
  }
}

class ByteWriter {
  private chunks: Uint8Array[] = []
  private totalLength = 0
  private current: number[] = []

  public writeByte(b: number): void {
    this.current.push(b)
    if (this.current.length >= 8192) {
      this.flush()
    }
  }

  public writeAscii(str: string): void {
    for (let i = 0; i < str.length; i++) {
      this.writeByte(str.charCodeAt(i) & 0xff)
    }
  }

  public writeBytes(raw: Uint8Array): void {
    this.flush()
    this.chunks.push(raw)
    this.totalLength += raw.length
  }

  private flush(): void {
    if (this.current.length > 0) {
      const u8 = new Uint8Array(this.current)
      this.chunks.push(u8)
      this.totalLength += u8.length
      this.current = []
    }
  }

  public toBytes(): Uint8Array {
    this.flush()
    const result = new Uint8Array(this.totalLength)
    let offset = 0
    for (const chunk of this.chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }
    return result
  }
}

export function serializeContent(ops: ContentOp[]): Uint8Array {
  const writer = new ByteWriter()

  for (const op of ops) {
    if (op.operator === 'BI') {
      const img = op.operands.find((o) => o.type === 'inline-image')
      if (img && img.type === 'inline-image') {
        writer.writeBytes(img.bytes)
        writer.writeByte(0x0a)
      }
      continue
    }

    if (op.operands.length > 0) {
      writer.writeAscii(op.operands.map(serializeOperand).join(' '))
      writer.writeByte(0x20)
      writer.writeAscii(op.operator)
      writer.writeByte(0x0a)
    } else {
      writer.writeAscii(op.operator)
      writer.writeByte(0x0a)
    }
  }

  return writer.toBytes()
}
