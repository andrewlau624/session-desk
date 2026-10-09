import { describe, expect, it } from 'vitest'
import { withTurnEnd } from '../src/main/status'
import { parseSession } from '../src/main/sessions'
import { startWork } from '../src/renderer/src/startWork'
import type { BoardCard } from '../src/shared/types'
import { session, tmp, userTurn, writeTranscript } from './helpers'

const ID = '22222222-2222-4222-8222-222222222222'
// The measured case: a question at 22:42:45, dismissed with Esc; the turn ends at 22:42:48.857 and no hook runs.
const asked = { state: 'waiting' as const, event: 'PermissionRequest', at: Date.parse('2026-10-08T22:42:45Z') / 1000 }
const ended = Date.parse('2026-10-08T22:42:48.857Z')

describe('a dialog dismissed with Esc', () => {
  it('reads as idle once the transcript records the turn ending after it', () => {
    expect(withTurnEnd(asked, ended)).toMatchObject({ state: 'waiting', event: 'TurnEnded' })
  })

  it('a dialog still open (the turn ended before it) stays a dialog', () => {
    expect(withTurnEnd(asked, ended - 60_000)).toBe(asked)
    // Within the hook's one-second resolution, assume it's the earlier turn.
    expect(withTurnEnd(asked, asked.at * 1000 + 500)).toBe(asked)
  })

  it('leaves working, Stop and missing activity alone', () => {
    const working = { state: 'working' as const, event: 'PostToolUse', at: asked.at }
    expect(withTurnEnd(working, ended)).toBe(working)
    expect(withTurnEnd({ ...asked, event: 'Stop' }, ended)?.event).toBe('Stop')
    expect(withTurnEnd(null, ended)).toBeNull()
  })

  it('the parser records when the last turn ended', async () => {
    const s = await parseSession(
      writeTranscript(tmp(), ID, [
        userTurn('hi'),
        { type: 'system', subtype: 'turn_duration', durationMs: 14076, timestamp: '2026-10-08T22:41:04.090Z' },
        { type: 'system', subtype: 'turn_duration', durationMs: 3628, timestamp: '2026-10-08T22:42:48.857Z' }
      ])
    )
    expect(s?.turnEndedAt).toBe(ended)
  })

  it('so moving its card into In Progress types the turn rather than leaving it', () => {
    const card = { issue: { identifier: 'ENG-1' }, column: 'todo', sessionIds: ['s'], prSessionIds: [], prs: [], relatedPrs: [] } as unknown as BoardCard
    const s = session({ id: 's', activity: withTurnEnd(asked, ended) })
    expect(startWork(card, [s], new Set(['s']))).toMatchObject({ kind: 'type' })
  })
})
