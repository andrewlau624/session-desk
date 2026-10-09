import { describe, expect, it } from 'vitest'
import { planPins } from '../src/main/autoPin'
import type { AutoPin } from '../src/main/store'
import type { BoardCard } from '../src/shared/types'

const card = (column: BoardCard['column'], ...sessionIds: string[]) => ({ column, sessionIds })
const plan = (cards: ReturnType<typeof card>[], pinned: string[] = [], records: Record<string, AutoPin> = {}) =>
  planPins(cards, (id) => pinned.includes(id), (id) => records[id])

describe('pinning sessions as their tickets move', () => {
  it('pins the sessions of a ticket that left To Do, and nothing in To Do', () => {
    expect(plan([card('todo', 'a'), card('in_progress', 'b'), card('waiting', 'c'), card('in_review', 'd')])).toEqual([
      { sessionId: 'b', pin: true, record: 'pinned' },
      { sessionId: 'c', pin: true, record: 'pinned' },
      { sessionId: 'd', pin: true, record: 'pinned' }
    ])
  })

  it('at Done, unpins only what it pinned', () => {
    expect(plan([card('done', 'b')], ['b'], { b: 'pinned' })).toEqual([{ sessionId: 'b', pin: false, record: 'unpinned' }])
    // Pinned by you before the ticket started: kept, and never unpinned.
    expect(plan([card('in_progress', 'm')], ['m'])).toEqual([{ sessionId: 'm', pin: true, record: 'kept' }])
    expect(plan([card('done', 'm')], ['m'], { m: 'kept' })).toEqual([])
    // A Done ticket the app never touched (pinned by you): left alone.
    expect(plan([card('done', 'x')], ['x'])).toEqual([])
  })

  it("respects an unpin you made mid-ticket, and acts once per change", () => {
    expect(plan([card('in_progress', 'b')], [], { b: 'pinned' })).toEqual([])
    expect(plan([card('in_progress', 'b')], ['b'], { b: 'pinned' })).toEqual([])
    expect(plan([card('done', 'b')], [], { b: 'unpinned' })).toEqual([])
  })

  it('pins again when a Done ticket is reopened', () => {
    expect(plan([card('in_progress', 'b')], [], { b: 'unpinned' })).toEqual([{ sessionId: 'b', pin: true, record: 'pinned' }])
  })
})
