import { describe, it, expect } from 'vitest'

describe('smoke test - DOMParser in jsdom', () => {
  it('DOMParser exists and can parse XML with namespace', () => {
    expect(typeof DOMParser).toBe('function')

    const xmlString = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p>
            <w:r>
              <w:t>Hello Test</w:t>
            </w:r>
          </w:p>
        </w:body>
      </w:document>
    `.trim()

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlString, 'application/xml')

    expect(doc).toBeDefined()
    const parserError = doc.querySelector('parsererror')
    expect(parserError).toBeNull()

    const textNodes = doc.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      't'
    )
    expect(textNodes.length).toBe(1)
    expect(textNodes[0].textContent).toBe('Hello Test')
  })
})
