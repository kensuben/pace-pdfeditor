export const OOXML_NAMESPACES = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  w16du: 'http://schemas.microsoft.com/office/word/2015/wordml/symex',
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
