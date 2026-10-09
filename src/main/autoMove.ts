import type { PrLink, SessionSummary } from '../shared/types'
import { columnFor, type RawBoard } from './linear'

export type AutoRule = 'start' | 'review'

export interface AutoMove {
  ticket: string
  rule: AutoRule
  to: 'in_progress' | 'in_review'
  /** Shown in the notification: what triggered it. */
  because: string
}

/**
 * Which tickets to move, given the board, sessions and PRs. Pure, so it can be
 * tested; the caller performs the moves.
 *
 * Forward only (To Do → In Progress → In Review), never on In Review, Done or
 * Canceled tickets, at most once per ticket per rule (`done`), and only for
 * activity or PRs that began after the rule was enabled (`since`, ms): turning
 * a rule on never sweeps the whole board.
 */
export function planMoves(opts: {
  board: RawBoard
  sessions: SessionSummary[]
  /** The ticket's PRs as its board card shows them (Linear-attached, or a linked session's PR on a branch naming it). */
  prs: (ticket: string) => PrLink[]
  since: Partial<Record<AutoRule, number>>
  done: (ticket: string, rule: AutoRule) => boolean
}): AutoMove[] {
  const moves: AutoMove[] = []
  for (const issue of opts.board.issues) {
    const t = issue.identifier
    const column = columnFor(issue.state, false)
    const startSince = opts.since.start
    // Explicit types, not the board column: anything unrecognised (canceled,
    // duplicate, triage) must never be pulled into In Progress.
    const notStarted = issue.state.type === 'unstarted' || issue.state.type === 'backlog'
    if (startSince && notStarted && !opts.done(t, 'start')) {
      const working = opts.sessions.find(
        (s) => s.tickets[0] === t && s.activity?.state === 'working' && s.activity.at * 1000 >= startSince
      )
      if (working) moves.push({ ticket: t, rule: 'start', to: 'in_progress', because: `a session started working: ${working.title}` })
    }
    const reviewSince = opts.since.review
    if (reviewSince && column === 'in_progress' && !opts.done(t, 'review')) {
      const pr = opts.prs(t).find(
        (p) =>
          p.info?.state === 'OPEN' && !p.info.draft && Date.parse(p.info.status?.readyAt ?? '') >= reviewSince
      )
      if (pr) moves.push({ ticket: t, rule: 'review', to: 'in_review', because: `PR ${pr.repo.split('/').pop()}#${pr.number} opened` })
    }
  }
  return moves
}
