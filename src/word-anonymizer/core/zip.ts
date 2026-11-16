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

  // Verify total decompressed size by counting bytes
  let totalDecompressed = 0
  for (const path of entries) {
    const file = zip.files[path]
    if (file.dir) continue

    // Fast check for uncompressedSize metadata if present
    const rawSize = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (typeof rawSize === 'number' && rawSize > LIMITS.maxUncompressedSize) {
      throw new AnonymizerError(
        'ZIP_BOMB',
        'Tổng dung lượng giải nén vượt quá giới hạn an toàn (300 MB).'
      )
    }

    const data = await file.async('uint8array')
    totalDecompressed += data.byteLength
    if (totalDecompressed > LIMITS.maxUncompressedSize) {
      throw new AnonymizerError(
        'ZIP_BOMB',
        'Tổng dung lượng giải nén vượt quá giới hạn an toàn (300 MB).'
      )
    }
  }

  return zip
}
