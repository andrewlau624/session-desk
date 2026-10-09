import type { BoardCard, SessionSummary } from '../shared/types'
import { fetchBoard } from './linear'
import { buildBoard } from './link'
import { store, type AutoPin } from './store'

/**
 * What the app did about a session's pin. pinned: the app pinned it, so it
 * may unpin it at Done. kept: you had already pinned it; the app never
 * unpins that. unpinned: the app unpinned it at Done; pinned again if the
 * ticket is reopened.
 */
export interface PinChange {
  sessionId: string
  pin: boolean
  record: AutoPin
}

const STARTED = new Set<BoardCard['column']>(['in_progress', 'waiting', 'in_review'])

/**
 * Sessions of tickets that have left To Do get pinned; at Done the app
 * unpins the ones it pinned. Your own pins and unpins are left alone: a
 * session you unpinned mid-ticket stays unpinned (the record is still there).
 */
export function planPins(
  cards: Pick<BoardCard, 'column' | 'sessionIds'>[],
  isPinned: (id: string) => boolean,
  recordOf: (id: string) => AutoPin | undefined
): PinChange[] {
  const changes: PinChange[] = []
  for (const card of cards) {
    for (const sessionId of card.sessionIds) {
      const record = recordOf(sessionId)
      if (STARTED.has(card.column)) {
        if (!record) changes.push(isPinned(sessionId) ? { sessionId, pin: true, record: 'kept' } : { sessionId, pin: true, record: 'pinned' })
        else if (record === 'unpinned') changes.push({ sessionId, pin: true, record: 'pinned' })
      } else if (card.column === 'done' && record === 'pinned') {
        changes.push({ sessionId, pin: false, record: 'unpinned' })
      }
    }
  }
  return changes
}

const MIN_INTERVAL_MS = 5_000
let lastRun = 0
let running = false

/** Applies planPins to the current board. Resolves true if a pin changed. `now`: skip the throttle (a move just happened). */
export async function runAutoPins(sessions: () => Promise<SessionSummary[]>, now = false): Promise<boolean> {
  if (running || (!now && Date.now() - lastRun < MIN_INTERVAL_MS)) return false
  running = true
  lastRun = Date.now()
  try {
    const [raw, ss] = await Promise.all([fetchBoard(), sessions()])
    const changes = planPins(buildBoard(raw, ss).cards, store.isPinned, store.autoPinOf)
    let changed = false
    for (const c of changes) {
      if (store.isPinned(c.sessionId) !== c.pin) {
        await store.setPinned(c.sessionId, c.pin)
        changed = true
      }
      await store.setAutoPin(c.sessionId, c.record)
    }
    return changed
  } catch {
    // Linear unreachable or not connected: nothing to go on.
    return false
  } finally {
    running = false
  }
}
