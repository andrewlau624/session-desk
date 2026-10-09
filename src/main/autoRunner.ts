import { Notification } from 'electron'
import type { SessionSummary } from '../shared/types'
import { planMoves } from './autoMove'
import { fetchBoard, gitAutomations, invalidate, moveIssue } from './linear'
import { buildBoard } from './link'
import { store } from './store'

const MIN_INTERVAL_MS = 30_000
const AUTOMATIONS_TTL_MS = 60 * 60_000

/** Linear's own GitHub-driven rules for the team on the board (event -> state name). */
let linearRules: { at: number; rules: { event: string; state: string }[] } | null = null
let lastRun = 0
let running = false

export function linearOwnRules(): { event: string; state: string }[] {
  return linearRules?.rules ?? []
}

/** Linear already moves tickets when a PR is up for review: the app's review rule would duplicate it. */
export function linearHandlesReview(): string | null {
  return linearOwnRules().find((r) => r.event === 'review')?.state ?? null
}

/** Another project's Linear team may have other rules. */
export function resetLinearRules(): void {
  linearRules = null
}

export async function loadLinearRules(): Promise<void> {
  if (linearRules && Date.now() - linearRules.at < AUTOMATIONS_TTL_MS) return
  const teamId = (await fetchBoard()).issues[0]?.teamId
  if (!teamId) return
  linearRules = { at: Date.now(), rules: await gitAutomations(teamId) }
}

/**
 * Applies the enabled automatic moves. Off unless the user turned a rule on;
 * throttled; never overlaps itself. `say` reports each move.
 */
export async function runAutoMoves(sessions: () => Promise<SessionSummary[]>, say: (text: string) => void): Promise<boolean> {
  const since = store.autoSince()
  if (linearHandlesReview()) delete since.review
  if (!since.start && !since.review) return false
  if (running || Date.now() - lastRun < MIN_INTERVAL_MS) return false
  running = true
  lastRun = Date.now()
  try {
    const raw = await fetchBoard()
    const ss = await sessions()
    const cards = new Map(buildBoard(raw, ss).cards.map((c) => [c.issue.identifier, c]))
    const moves = planMoves({
      board: raw,
      sessions: ss,
      prs: (t) => cards.get(t)?.prs ?? [],
      since,
      done: (t, rule) => store.autoDone(t, rule)
    })
    for (const m of moves) {
      const issue = raw.issues.find((i) => i.identifier === m.ticket)!
      await moveIssue(issue, m.to)
      await store.markAutoDone(m.ticket, m.rule)
      const text = `Moved ${m.ticket} to ${m.to === 'in_review' ? 'In Review' : 'In Progress'}: ${m.because}`
      say(text)
      if (Notification.isSupported()) new Notification({ title: 'Linear updated', body: text }).show()
    }
    if (moves.length) invalidate()
    return moves.length > 0
  } catch {
    // Linear unreachable or not connected: try again next round.
    return false
  } finally {
    running = false
  }
}
