import { describe, expect, it } from 'vitest'
import { clampWidth, SIDEBAR_MIN } from '../src/renderer/src/sidebarWidth'

describe('sidebar width', () => {
  it('keeps a width that fits', () => {
    expect(clampWidth(320, 1600)).toBe(320)
  })

  it('never goes narrower than the minimum', () => {
    expect(clampWidth(50, 1600)).toBe(SIDEBAR_MIN)
  })

  it('stops at the maximum on a wide window', () => {
    expect(clampWidth(2000, 3000)).toBe(560)
  })

  it('leaves the main pane room on a narrow window', () => {
    expect(clampWidth(500, 800)).toBe(380)
  })

  it('still gives the minimum when the window is too narrow for both', () => {
    expect(clampWidth(300, 500)).toBe(SIDEBAR_MIN)
  })

  it('rounds to whole pixels', () => {
    expect(clampWidth(301.6, 1600)).toBe(302)
  })
})
