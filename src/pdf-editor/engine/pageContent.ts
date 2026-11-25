import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
} from 'pdf-lib'

export function readPageContent(doc: PDFDocument, pageIndex: number): Uint8Array {
  const page = doc.getPage(pageIndex)
  const contents = page.node.Contents()
  if (!contents) return new Uint8Array(0)

  const resolved = doc.context.lookup(contents)
  const streamRefs = resolved instanceof PDFArray ? resolved.asArray() : [contents]

  const parts: Uint8Array[] = []
  for (const ref of streamRefs) {
    const streamObj = doc.context.lookup(ref)
    if (!streamObj) continue

    if (streamObj instanceof PDFRawStream) {
      const filter = streamObj.dict.lookup(PDFName.of('Filter'))
      try {
        const decoded = decodePDFRawStream(streamObj).decode()
        parts.push(decoded)
      } catch (err: unknown) {
        const filterName = filter ? filter.toString() : 'Unknown'
        throw new Error(
          `Unsupported stream filter '${filterName}': ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        )
      }
    } else if (streamObj instanceof PDFStream) {
      if ('getUnencodedContents' in streamObj && typeof streamObj.getUnencodedContents === 'function') {
        parts.push(streamObj.getUnencodedContents())
      } else {
        const filter = streamObj.dict?.lookup(PDFName.of('Filter'))
        try {
          const decoded = decodePDFRawStream(streamObj as unknown as PDFRawStream).decode()
          parts.push(decoded)
        } catch (err: unknown) {
          const filterName = filter ? filter.toString() : 'Unknown'
          throw new Error(
            `Unsupported stream filter '${filterName}': ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          )
        }
      }
    }
  }

  if (parts.length === 0) return new Uint8Array(0)
  if (parts.length === 1) return parts[0]

  let totalLen = 0
  for (let i = 0; i < parts.length; i++) {
    totalLen += parts[i].length + (i > 0 ? 1 : 0) // join with newline 0x0A
  }

  const combined = new Uint8Array(totalLen)
  let offset = 0
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      combined[offset++] = 0x0a
    }
    combined.set(parts[i], offset)
    offset += parts[i].length
  }

  return combined
}

export function writePageContent(doc: PDFDocument, pageIndex: number, bytes: Uint8Array): void {
  const page = doc.getPage(pageIndex)
  const newStream = doc.context.flateStream(bytes)
  const streamRef = doc.context.register(newStream)
  page.node.set(PDFName.of('Contents'), doc.context.obj([streamRef]))
}
