export const OOXML_NAMESPACES = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  // TODO(verify): URI w16du - Tài liệu [MS-DOCX] xác định w16du cho Word 365 có thể là http://schemas.microsoft.com/office/word/2023/wordml/du hoặc 2018/wordml/du; cần xác nhận thêm trên các bản Office 365 khác nhau.
  w16du: 'http://schemas.microsoft.com/office/word/2023/wordml/du',
  // TODO(verify): Thuộc tính w16cex:dateUtc - Thuộc tính dateUtc trong namespace w16cex (http://schemas.microsoft.com/office/word/2018/wordml/cex) được dùng trong thread comment mở rộng, cần đối chiếu với tài liệu ECMA/MS-DOCX.
  w16cex: 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  coreProps: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  appProps: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  customProps: 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties',
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
} as const

export const LIMITS = {
  maxInputSize: 50 * 1024 * 1024, // 50 MB
  maxUncompressedSize: 300 * 1024 * 1024, // 300 MB
  maxEntryCount: 2000,
} as const

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
