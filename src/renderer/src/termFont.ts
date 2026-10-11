export const TERM_FONT_DEFAULT = 11
export const TERM_FONT_MIN = 8
export const TERM_FONT_MAX = 24
const KEY = 'terminalFontSize'

/** A whole-point size within the range. */
export function clampFont(size: number): number {
  return Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, Math.round(size)))
}

/** The size saved last, or the default. A per-window convenience, so storage failing is fine. */
export function loadFontSize(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return Number.isInteger(n) && n >= TERM_FONT_MIN && n <= TERM_FONT_MAX ? n : TERM_FONT_DEFAULT
  } catch {
    return TERM_FONT_DEFAULT
  }
}

export function saveFontSize(size: number): void {
  try {
    localStorage.setItem(KEY, String(size))
  } catch {
    // Not saved; the next launch starts at the default.
  }
}
