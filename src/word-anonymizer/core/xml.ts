import { XML_DECLARATION } from './constants'
import { AnonymizerError } from './types'

export function parseXml(xmlString: string): Document {
  if (/<!DOCTYPE/i.test(xmlString) || /<!ENTITY/i.test(xmlString)) {
    throw new AnonymizerError(
      'INVALID_XML',
      'Nội dung XML trong tệp chứa khai báo DTD (DOCTYPE/ENTITY) không an toàn.'
    )
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'application/xml')

  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new AnonymizerError(
      'INVALID_XML',
      `Nội dung XML không hợp lệ: ${parserError.textContent?.slice(0, 100) || 'Lỗi phân tích cú pháp'}`
    )
  }

  return doc
}

export function serializeXml(doc: Document): string {
  const serializer = new XMLSerializer()
  let xml = serializer.serializeToString(doc)

  // Remove existing XML declaration if present to avoid duplication
  xml = xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, '')

  return `${XML_DECLARATION}${xml}`
}
