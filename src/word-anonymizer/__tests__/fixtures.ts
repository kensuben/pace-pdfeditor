import JSZip from 'jszip'

export interface FixtureComment {
  id: number
  author: string
  initials: string
  date?: string
  dateUtc?: { ns: string; name: string; value: string }
  text?: string
  hyperlink?: {
    rId: string
    text: string
  }
  rawContent?: string
  innerRevisions?: Array<{
    type: 'ins' | 'del'
    author: string
    text: string
  }>
}

export interface FixtureOptions {
  comments?: FixtureComment[]
  commentsExtended?: Array<{
    paraId: string
    paraIdParent?: string
    durableId?: string
    dateUtc?: string
  }>
  revisions?: Array<{
    type: 'ins' | 'del' | 'rPrChange'
    author: string
    date?: string
    part: 'document' | 'header' | 'footnotes'
    text?: string
    isDelText?: boolean
  }>
  documentText?: string
  people?: Array<{
    author: string
    userId?: string
    providerId?: string
  }>
  mentions?: Array<{
    relId: string
    email?: string
    target?: string
  }>
  coreProps?: {
    creator?: string
    lastModifiedBy?: string
    lastPrinted?: string
  }
  appProps?: {
    company?: string
    manager?: string
    template?: string
  }
  customProps?: Array<{
    name: string
    value: string
  }>
  customNamespaces?: {
    wordPrefix?: string
    wordNs?: string
  }
  unrelatedPart?: {
    path: string
    content: Uint8Array
  }
  compression?: 'STORE' | 'DEFLATE'
  extraXmlFiles?: Record<string, string>
  documentXmlOverride?: string
}

export async function createMockDocx(options: FixtureOptions = {}): Promise<ArrayBuffer> {
  const zip = new JSZip()
  const wPrefix = options.customNamespaces?.wordPrefix || 'w'
  const wNs =
    options.customNamespaces?.wordNs ||
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

  // [Content_Types].xml
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  )

  // _rels/.rels
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  )

  // word/document.xml
  if (options.documentXmlOverride) {
    zip.file('word/document.xml', options.documentXmlOverride)
  } else {
    let documentBody = `<${wPrefix}:p><${wPrefix}:r><${wPrefix}:t>${options.documentText || 'Nội dung kiểm tra'}</${wPrefix}:t></${wPrefix}:r></${wPrefix}:p>`
    if (options.revisions) {
      for (const rev of options.revisions) {
        if (rev.part === 'document') {
          const dateAttr = rev.date ? ` ${wPrefix}:date="${rev.date}"` : ''
          if (rev.isDelText) {
            documentBody += `<${wPrefix}:${rev.type} ${wPrefix}:author="${rev.author}"${dateAttr}><${wPrefix}:r><${wPrefix}:delText>${rev.text || 'rev'}</${wPrefix}:delText></${wPrefix}:r></${wPrefix}:${rev.type}>`
          } else {
            documentBody += `<${wPrefix}:${rev.type} ${wPrefix}:author="${rev.author}"${dateAttr}><${wPrefix}:r><${wPrefix}:t>${rev.text || 'rev'}</${wPrefix}:t></${wPrefix}:r></${wPrefix}:${rev.type}>`
          }
        }
      }
    }

    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${wPrefix}:document xmlns:${wPrefix}="${wNs}">
  <${wPrefix}:body>
    ${documentBody}
  </${wPrefix}:body>
</${wPrefix}:document>`
    )
  }

  // word/comments.xml
  if (options.comments && options.comments.length > 0) {
    let commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${wPrefix}:comments xmlns:${wPrefix}="${wNs}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    for (const c of options.comments) {
      const dateAttr = c.date ? ` ${wPrefix}:date="${c.date}"` : ''
      let extraNsAttr = ''
      if (c.dateUtc) {
        extraNsAttr = ` xmlns:customDu="${c.dateUtc.ns}" customDu:${c.dateUtc.name}="${c.dateUtc.value}"`
      }

      let innerContent = `<${wPrefix}:p>`
      if (c.rawContent) {
        innerContent += c.rawContent
      } else {
        if (c.hyperlink) {
          innerContent += `<${wPrefix}:hyperlink r:id="${c.hyperlink.rId}"><${wPrefix}:r><${wPrefix}:t>${c.hyperlink.text}</${wPrefix}:t></${wPrefix}:r></${wPrefix}:hyperlink>`
        }
        if (c.text) {
          innerContent += `<${wPrefix}:r><${wPrefix}:t>${c.text}</${wPrefix}:t></${wPrefix}:r>`
        }
        if (c.innerRevisions) {
          for (const rev of c.innerRevisions) {
            innerContent += `<${wPrefix}:${rev.type} ${wPrefix}:author="${rev.author}"><${wPrefix}:r><${wPrefix}:t>${rev.text}</${wPrefix}:t></${wPrefix}:r></${wPrefix}:${rev.type}>`
          }
        }
      }
      innerContent += `</${wPrefix}:p>`

      commentsXml += `\n  <${wPrefix}:comment ${wPrefix}:id="${c.id}" ${wPrefix}:author="${c.author}" ${wPrefix}:initials="${c.initials}"${dateAttr}${extraNsAttr}>
    ${innerContent}
  </${wPrefix}:comment>`
    }
    commentsXml += `\n</${wPrefix}:comments>`
    zip.file('word/comments.xml', commentsXml)
  }

  // word/commentsExtended.xml
  if (options.commentsExtended && options.commentsExtended.length > 0) {
    let extXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex">`
    for (const item of options.commentsExtended) {
      const parentAttr = item.paraIdParent ? ` w15:paraIdParent="${item.paraIdParent}"` : ''
      const durAttr = item.durableId ? ` w16cex:durableId="${item.durableId}"` : ''
      const dateUtcAttr = item.dateUtc ? ` w16cex:dateUtc="${item.dateUtc}"` : ''
      extXml += `\n  <w15:commentEx w15:paraId="${item.paraId}"${parentAttr}${durAttr}${dateUtcAttr}/>`
    }
    extXml += `\n</w15:commentsEx>`
    zip.file('word/commentsExtended.xml', extXml)
  }

  // word/_rels/comments.xml.rels
  if (options.mentions && options.mentions.length > 0) {
    let relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    for (const m of options.mentions) {
      const target = m.target || `mailto:${m.email}`
      relsXml += `\n  <Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${target}" TargetMode="External"/>`
    }
    relsXml += `\n</Relationships>`
    zip.file('word/_rels/comments.xml.rels', relsXml)
  }

  // word/people.xml
  if (options.people && options.people.length > 0) {
    let peopleXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">`
    for (const p of options.people) {
      const presence =
        p.userId || p.providerId
          ? `<w15:presenceInfo w15:providerId="${p.providerId || 'None'}" w15:userId="${p.userId || ''}"/>`
          : ''
      peopleXml += `\n  <w15:person w15:author="${p.author}">${presence}</w15:person>`
    }
    peopleXml += `\n</w15:people>`
    zip.file('word/people.xml', peopleXml)
  }

  // header and footnotes
  if (options.revisions) {
    for (const rev of options.revisions) {
      if (rev.part === 'header') {
        const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${wPrefix}:hdr xmlns:${wPrefix}="${wNs}">
  <${wPrefix}:p><${wPrefix}:${rev.type} ${wPrefix}:author="${rev.author}"><${wPrefix}:r><${wPrefix}:t>header text</${wPrefix}:t></${wPrefix}:r></${wPrefix}:${rev.type}></${wPrefix}:p>
</${wPrefix}:hdr>`
        zip.file('word/header1.xml', headerXml)
      } else if (rev.part === 'footnotes') {
        const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${wPrefix}:footnotes xmlns:${wPrefix}="${wNs}">
  <${wPrefix}:footnote><${wPrefix}:p><${wPrefix}:${rev.type} ${wPrefix}:author="${rev.author}"><${wPrefix}:r><${wPrefix}:t>footnote text</${wPrefix}:t></${wPrefix}:r></${wPrefix}:${rev.type}></${wPrefix}:p></${wPrefix}:footnote>
</${wPrefix}:footnotes>`
        zip.file('word/footnotes.xml', footnotesXml)
      }
    }
  }

  // docProps/core.xml
  if (options.coreProps) {
    const creator = options.coreProps.creator
      ? `<dc:creator>${options.coreProps.creator}</dc:creator>`
      : ''
    const modified = options.coreProps.lastModifiedBy
      ? `<cp:lastModifiedBy>${options.coreProps.lastModifiedBy}</cp:lastModifiedBy>`
      : ''
    const printed = options.coreProps.lastPrinted
      ? `<cp:lastPrinted>${options.coreProps.lastPrinted}</cp:lastPrinted>`
      : ''
    zip.file(
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  ${creator}
  ${modified}
  ${printed}
</cp:coreProperties>`
    )
  }

  // docProps/app.xml
  if (options.appProps) {
    zip.file(
      'docProps/app.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Company>${options.appProps.company || ''}</Company>
  <Manager>${options.appProps.manager || ''}</Manager>
  <Template>${options.appProps.template || 'Normal.dotm'}</Template>
</Properties>`
    )
  }

  // docProps/custom.xml
  if (options.customProps) {
    let customXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">`
    options.customProps.forEach((prop, idx) => {
      customXml += `\n  <property pid="${idx + 2}" name="${prop.name}"><vt:lpwstr>${prop.value}</vt:lpwstr></property>`
    })
    customXml += `\n</Properties>`
    zip.file('docProps/custom.xml', customXml)
  }

  // extra XML files
  if (options.extraXmlFiles) {
    for (const [path, content] of Object.entries(options.extraXmlFiles)) {
      zip.file(path, content)
    }
  }

  // unrelated binary part
  if (options.unrelatedPart) {
    zip.file(options.unrelatedPart.path, options.unrelatedPart.content)
  }

  return zip.generateAsync({
    type: 'arraybuffer',
    compression: options.compression || 'DEFLATE',
  })
}
