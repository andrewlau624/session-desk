import { describe, expect, it, vi } from 'vitest'
import { currentChoice } from '../src/renderer/src/components/ModelPicker'
import { moveEntries } from '../src/renderer/src/sessionActions'
import { session } from './helpers'

describe('what the model button shows', () => {
  const s = (over: object = {}) => session({ model: 'claude-opus-5-5', effort: 'high', lastActivity: 1000, ...over })

  it("is the latest reply's model and effort", () => {
    expect(currentChoice(s(), null)).toEqual({ model: 'Opus 5.5', effort: 'high', alias: 'opus' })
  })

  it('a choice made here shows until a reply reflects it', () => {
    const chosen = { model: 'sonnet', effort: 'low', at: 2000 }
    expect(currentChoice(s(), chosen)).toEqual({ model: 'Sonnet', effort: 'low', alias: 'sonnet' })
    // A reply after the choice shows what actually ran (also catches /model typed in the terminal).
    expect(currentChoice(s({ model: 'claude-sonnet-5-5', effort: 'low', lastActivity: 3000 }), chosen)).toEqual({
      model: 'Sonnet 5.5',
      effort: 'low',
      alias: 'sonnet'
    })
  })

  it('a new chat before its first reply: the choice, or the defaults', () => {
    expect(currentChoice(null, null)).toEqual({ model: null, effort: null, alias: null })
    expect(currentChoice(null, { model: 'opus[1m]', at: 1 })).toEqual({ model: 'Opus (1M context)', effort: null, alias: 'opus[1m]' })
  })
})

describe('Move to group', () => {
  vi.stubGlobal('window', { desk: {} })
  const labels = (e: ReturnType<typeof moveEntries>) => e.map((x) => (x === 'divider' ? '—' : 'heading' in x ? `#${x.heading}` : x.label))

  it('says there are no groups yet, and offers New group…', () => {
    const e = moveEntries(session({}), [], () => {})
    expect(labels(e)).toEqual(['No groups yet', '—', 'New group…'])
  })

  it('lists existing groups with the current one marked, plus Remove from group', () => {
    const groups = [
      { id: 'g1', name: 'Auth', collapsed: false },
      { id: 'g2', name: 'Infra', collapsed: false }
    ]
    const e = moveEntries(session({ groupId: 'g2' }), groups, () => {})
    expect(labels(e)).toEqual(['Auth', 'Infra', '—', 'Remove from group', 'New group…'])
    const infra = e[1] as { checked?: boolean; disabled?: string | false }
    expect(infra.checked).toBe(true)
  })
})
