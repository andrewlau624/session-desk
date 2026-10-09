import { describe, expect, it, vi } from 'vitest'
import { currentChoice } from '../src/renderer/src/components/ModelPicker'
import { moveEntries } from '../src/renderer/src/sessionActions'
import { session } from './helpers'

describe('what the model and effort buttons show', () => {
  const s = (over: object = {}) => session({ model: 'claude-opus-5-5', effort: 'high', lastActivity: 1000, ...over })

  it("is the latest reply's model (with its version) and effort", () => {
    expect(currentChoice(s(), null)).toEqual({ model: 'Opus 5.5', modelId: 'claude-opus-5-5', effort: 'high' })
  })

  it('a choice made here shows until a reply reflects it', () => {
    const chosen = { model: 'claude-sonnet-4-6', effort: 'low', at: 2000 }
    expect(currentChoice(s(), chosen)).toEqual({ model: 'Sonnet 4.6', modelId: 'claude-sonnet-4-6', effort: 'low' })
    // A reply after the choice shows what actually ran (also catches /model typed in the terminal).
    expect(currentChoice(s({ model: 'claude-sonnet-5-5', effort: 'low', lastActivity: 3000 }), chosen)).toMatchObject({
      model: 'Sonnet 5.5',
      modelId: 'claude-sonnet-5-5'
    })
  })

  it('a 1M-context model is shown and ticked as that model', () => {
    expect(currentChoice(s(), { model: 'claude-opus-5-5[1m]', at: 2000 })).toMatchObject({ model: 'Opus 5.5', modelId: 'claude-opus-5-5' })
  })

  it('a new chat before its first reply: the choice, or the defaults', () => {
    expect(currentChoice(null, null)).toEqual({ model: null, modelId: null, effort: null })
    expect(currentChoice(null, { model: 'claude-fable-5-1', at: 1 })).toMatchObject({ model: 'Fable 5.1' })
  })
})

describe('keeping the 1M context your default uses', () => {
  it('adds [1m] to the same family only', async () => {
    const { withDefaultContext } = await import('../src/main/modelChoice')
    expect(withDefaultContext('claude-opus-5-5', 'opus[1m]')).toBe('claude-opus-5-5[1m]')
    expect(withDefaultContext('claude-opus-4-6', 'opus[1m]')).toBe('claude-opus-4-6[1m]')
    expect(withDefaultContext('claude-haiku-5-5', 'opus[1m]')).toBe('claude-haiku-5-5')
    expect(withDefaultContext('claude-opus-5-5', 'opus')).toBe('claude-opus-5-5')
    expect(withDefaultContext('claude-sonnet-5-5', 'claude-sonnet-5-5[1m]')).toBe('claude-sonnet-5-5[1m]')
    expect(withDefaultContext('claude-opus-5-5', null)).toBe('claude-opus-5-5')
  })
})

describe('Move to group', () => {
  vi.stubGlobal('window', { desk: {} })
  const labels = (e: ReturnType<typeof moveEntries>) => e.map((x) => (x === 'divider' ? '—' : 'heading' in x ? `#${x.heading}` : 'note' in x ? `#${x.note}` : x.label))

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
