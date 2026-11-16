export function normalizeString(str: string): string {
  return str.trim().normalize('NFC')
}

export function foldSearchString(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim()
}
