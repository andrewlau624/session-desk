import type { BoardCard, Kickoff, SessionSummary } from '../../shared/types'

/**
 * What moving a card into In Progress does. new: start a named session that
 * plans the ticket. resume: reopen its session with an opening turn. type:
 * the session is open here and idle at its prompt, so send the turn there.
 * leave: it's busy, waiting on your answer, or open in another app.
 */
export type StartWork =
  | { kind: 'new' }
  | { kind: 'resume' | 'type'; session: SessionSummary; kickoff: Kickoff }
  | { kind: 'leave'; session: SessionSummary; reason: 'working' | 'needs-you' | 'elsewhere' }

// A finished turn leaves the prompt empty and free (TurnEnded: one ended by
// dismissing a dialog); any other waiting event has a dialog open that typing would answer.
const IDLE_EVENTS = new Set(['Stop', 'StopFailure', 'TurnEnded'])

/** Where the ticket's session left off: no plan yet, a plan awaiting approval, or work under way. */
export function kickoffFor(s: Pick<SessionSummary, 'plan' | 'worked'>): Kickoff {
  if (s.plan === 'approved' || s.worked) return 'continue'
  if (s.plan === 'proposed') return 'represent'
  return 'replan'
}

/**
 * Whether a turn can be sent to a session now. idle: open here at an empty
 * prompt (type it). closed: no process (resume with it). Otherwise it's
 * working, showing a question or permission prompt, or open in another app.
 */
export type Readiness = 'idle' | 'closed' | 'working' | 'needs-you' | 'elsewhere'

export function readiness(session: SessionSummary, running: Set<string>): Readiness {
  if (running.has(session.id)) {
    const a = session.activity
    if (a?.state === 'working') return 'working'
    if (a && !IDLE_EVENTS.has(a.event)) return 'needs-you'
    return 'idle'
  }
  return session.liveElsewhere ? 'elsewhere' : 'closed'
}

/** Why a turn can't be sent right now, for a disabled button's tooltip; null when it can. */
export function busyReason(r: Readiness): string | null {
  switch (r) {
    case 'working':
      return 'Claude is working in this session; try again when it finishes'
    case 'needs-you':
      return 'This session is waiting on your answer to a question or permission prompt'
    case 'elsewhere':
      return 'This session is open in another app; ask there'
    default:
      return null
  }
}

/** Only the ticket's own sessions count; one that merely opened its PR is about another ticket. */
export function startWork(card: BoardCard, sessions: SessionSummary[], running: Set<string>): StartWork {
  const session = card.sessionIds.map((id) => sessions.find((s) => s.id === id)).find(Boolean)
  if (!session) return { kind: 'new' }
  const r = readiness(session, running)
  if (r === 'idle') return { kind: 'type', session, kickoff: kickoffFor(session) }
  if (r === 'closed') return { kind: 'resume', session, kickoff: kickoffFor(session) }
  return { kind: 'leave', session, reason: r }
}

const DOING: Record<Kickoff, string> = {
  plan: 'Planning',
  replan: 'Planning',
  represent: 'Showing the plan again for',
  continue: 'Continuing',
  'open-pr': 'Asking Claude to open the PR for'
}

/** The toast for each outcome. */
export function startWorkNotice(ticket: string, plan: StartWork): string {
  switch (plan.kind) {
    case 'new':
      return `Planning ${ticket} in a new session`
    case 'resume':
    case 'type':
      return `${DOING[plan.kickoff]} ${ticket}`
    case 'leave':
      return plan.reason === 'working'
        ? `${ticket}'s session is already working`
        : plan.reason === 'needs-you'
          ? `${ticket}'s session is waiting for your answer`
          : `${ticket}'s session is open in ${plan.session.liveElsewhere?.entrypoint ?? 'another app'}; continue it there`
  }
}
