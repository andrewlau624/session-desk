import { describe, expect, it } from 'vitest'
import { detectMode, MODE_CYCLE } from '../src/main/pty'

// Footer redraws as captured from Claude Code 2.1.295 (cells that didn't change are skipped, so letters drop).
const footer = {
  auto: '\x1b[38;5;214m⏵⏵ auto mode on\x1b[39m (shift+tab to cycle) · ← for agents',
  manual: ' \x0f ⏸ m\x1b[1Cnual mode on · ? for short\x1b[1Cuts · ← for agents',
  acceptEdits: ' ⏵⏵ \x1b[2Cccept e\x1b[1Cits on (shift+tab to cycle) · ← for agents',
  plan: ' ⏸ plan mod\x1b[1Con (shift+tab \x1b[1Co cycle) · ← for agents',
  bypass: ' ⏵⏵ bypass permissions on (shift+tab to cycle)'
}

describe('reading the permission mode off the terminal', () => {
  it('recognises each footer, even with dropped letters', () => {
    expect(detectMode(footer.auto)).toBe('auto')
    expect(detectMode(footer.manual)).toBe('manual')
    expect(detectMode(footer.acceptEdits)).toBe('acceptEdits')
    expect(detectMode(footer.plan)).toBe('plan')
    expect(detectMode(footer.bypass)).toBe('bypassPermissions')
    expect(detectMode('just some output')).toBeNull()
  })

  it('the latest footer wins (Shift+Tab pressed in the terminal)', () => {
    expect(detectMode(footer.auto + 'lots of output' + footer.manual + footer.plan)).toBe('plan')
    expect(detectMode(footer.plan + footer.auto)).toBe('auto')
  })

  it('cycles in the order measured: Auto, Manual, Accept edits, Plan', () => {
    expect(MODE_CYCLE).toEqual(['auto', 'manual', 'acceptEdits', 'plan'])
  })
})
