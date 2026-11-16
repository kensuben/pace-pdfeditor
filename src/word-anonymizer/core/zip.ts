import JSZip from 'jszip'
import { LIMITS } from './constants'
import { AnonymizerError } from './types'

export async function loadSafeDocx(input: ArrayBuffer): Promise<JSZip> {
  if (input.byteLength > LIMITS.maxInputSize) {
    throw new AnonymizerError(
      'TOO_LARGE',
      `Dung lượng tệp (${Math.round(input.byteLength / 1024 / 1024)} MB) vượt quá giới hạn cho phép (50 MB).`
    )
  }

  const bytes = new Uint8Array(input)
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    throw new AnonymizerError(
      'ENCRYPTED_OR_LEGACY',
      'Tệp được mã hoá hoặc ở định dạng Word cũ (.doc). Vui lòng lưu lại thành .docx chuẩn không đặt mật khẩu.'
    )
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(input)
  } catch {
    throw new AnonymizerError(
      'NOT_DOCX',
      'Định dạng không phải là tệp .docx hợp lệ hoặc tệp bị hỏng.'
    )
  }

  const entries = Object.keys(zip.files)

  if (entries.length > LIMITS.maxEntryCount) {
    throw new AnonymizerError(
      'ZIP_BOMB',
      `Số lượng phần tử trong tệp nén (${entries.length}) vượt quá giới hạn cho phép (${LIMITS.maxEntryCount}).`
    )
  }

  let hasContentTypes = false
  let hasDocumentXml = false

  for (const path of entries) {
    if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
      throw new AnonymizerError(
        'NOT_DOCX',
        `Tệp nén chứa đường dẫn không an toàn: ${path}`
      )
    }

    const lower = path.toLowerCase()
    if (lower === '[content_types].xml') {
      hasContentTypes = true
    } else if (lower === 'word/document.xml') {
      hasDocumentXml = true
    } else if (lower === 'vbaproject.bin' || lower.endsWith('/vbaproject.bin')) {
      throw new AnonymizerError(
        'MACRO_ENABLED',
        'Tệp Word chứa macro (vbaProject.bin). Để bảo mật, vui lòng lưu lại thành .docx chuẩn không chứa macro.'
      )
    }
  }

  if (!hasContentTypes || !hasDocumentXml) {
    throw new AnonymizerError(
      'NOT_DOCX',
      'Tệp thiếu các thành phần bắt buộc của tệp Word (.docx): [Content_Types].xml hoặc word/document.xml.'
    )
  }

  // Verify total decompressed size by counting bytes safely with streaming
  let totalDecompressed = 0
  for (const path of entries) {
    const file = zip.files[path]
    if (file.dir) continue

    const rawSize = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (typeof rawSize === 'number' && rawSize > LIMITS.maxUncompressedSize) {
      throw new AnonymizerError(
        'ZIP_BOMB',
        'Tổng dung lượng giải nén vượt quá giới hạn an toàn (300 MB).'
      )
    }

    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = (file as any).internalStream('uint8array')
      let entryBytes = 0

      stream.on('data', (chunk: Uint8Array) => {
        entryBytes += chunk.byteLength
        totalDecompressed += chunk.byteLength
        if (entryBytes > LIMITS.maxUncompressedSize || totalDecompressed > LIMITS.maxUncompressedSize) {
          stream.pause()
          reject(
            new AnonymizerError(
              'ZIP_BOMB',
              'Tổng dung lượng giải nén vượt quá giới hạn an toàn (300 MB).'
            )
          )
        }
      })

      stream.on('error', (err: unknown) => reject(err))
      stream.on('end', () => resolve())
      stream.resume()
    })
  }

  return zip
}
