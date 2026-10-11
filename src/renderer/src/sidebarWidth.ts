export const SIDEBAR_DEFAULT = 280
export const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 560
/** Room the main pane keeps however wide the sidebar is dragged. */
const MAIN_MIN = 420
const KEY = 'sidebarWidth'

/** A width the sidebar can take in a window this wide. */
export function clampWidth(width: number, windowWidth: number): number {
  const max = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, windowWidth - MAIN_MIN))
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, width)))
}

/** The width saved last, or the default. A per-window convenience, so storage failing is fine. */
export function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return Number.isFinite(n) && n > 0 ? n : SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}

export function saveWidth(width: number): void {
  try {
    localStorage.setItem(KEY, String(width))
  } catch {
    // Not saved; the next launch starts at the default.
  }
}
