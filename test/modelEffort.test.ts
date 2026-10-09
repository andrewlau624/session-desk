import { describe, expect, it } from 'vitest'
import { parseSession } from '../src/main/sessions'
import { modelLabel } from '../src/renderer/src/format'
import { tmp, userTurn, writeTranscript } from './helpers'

const ID = '33333333-3333-4333-8333-333333333333'
// Shaped like Claude Code 2.1.29x assistant lines: model on the message, effort at the end.
const reply = (model: string, effort: string, extra: object = {}) => ({
  type: 'assistant',
  sessionId: ID,
  message: { model, role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  effort,
  perTurnEffort: effort,
  ...extra
})

describe("a session's model and effort", () => {
  it("are the latest reply's: /model and /effort show up on the next reply", async () => {
    const s = await parseSession(
      writeTranscript(tmp(), ID, [userTurn('hi'), reply('claude-sonnet-5-5', 'medium'), userTurn('again'), reply('claude-opus-5-5', 'high')])
    )
    expect(s).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' })
  })

  it("ignore subagents, made-up replies, and a tool call's own effort", async () => {
    const agentCall = {
      ...reply('claude-opus-5-5', 'xhigh'),
      message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Agent', input: { effort: 'low', model: 'haiku' } }] }
    }
    const s = await parseSession(
      writeTranscript(tmp(), ID, [
        userTurn('hi'),
        agentCall,
        reply('claude-haiku-5-5', 'low', { isSidechain: true }),
        reply('<synthetic>', 'xhigh')
      ])
    )
    expect(s).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('is null before the first reply', async () => {
    expect(await parseSession(writeTranscript(tmp(), ID, [userTurn('hi')]))).toMatchObject({ model: null, effort: null })
  })

  it('labels models as people say them', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-opus-5')).toBe('Opus 5')
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M)')
    expect(modelLabel('gpt-something')).toBe('gpt-something')
  })
})
