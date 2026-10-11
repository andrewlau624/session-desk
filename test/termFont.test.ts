import { describe, expect, it } from 'vitest'
import { clampFont, TERM_FONT_MAX, TERM_FONT_MIN } from '../src/renderer/src/termFont'

describe('terminal text size', () => {
  it('keeps a size in range', () => {
    expect(clampFont(13)).toBe(13)
  })

  it('stops at the smallest and largest sizes', () => {
    expect(clampFont(TERM_FONT_MIN - 1)).toBe(TERM_FONT_MIN)
    expect(clampFont(TERM_FONT_MAX + 1)).toBe(TERM_FONT_MAX)
  })

  it('rounds to whole points', () => {
    expect(clampFont(11.6)).toBe(12)
  })
})
