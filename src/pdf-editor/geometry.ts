export const uid = () => crypto.randomUUID()

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  }
}
