import { namesTicket } from '../shared/prs'
import type { Board, BoardCard, PrLink, SessionSummary } from '../shared/types'
import { withInfo } from './github'
import { columnFor, linearTicketsOfPr, type RawBoard } from './linear'
import { ticketsIn } from './sessions'
import { store } from './store'

function uniq(xs: string[]): string[] {
  return [...new Set(xs)]
}

/**
 * The ticket most of a session's PRs were opened for, if one clearly dominates.
 * Long sessions often open PRs for many tickets; then PRs say nothing about
 * which one the session is "about".
 */
/**
 * The ticket a PR is for: the one its branch names; else the issue it's
 * attached to in Linear (when attached to several, the one the PR itself
 * names, since the rest are attached for context).
 */
export function ticketOfPr(pr: PrLink): string | null {
  const fromBranch = ticketsIn(pr.info?.headRef)[0]
  if (fromBranch) return fromBranch
  const attached = linearTicketsOfPr(pr.url) ?? []
  if (attached.length === 1) return attached[0]
  const named = attached.filter((t) => pr.info?.mentions?.includes(t))
  return named.length === 1 ? named[0] : null
}

function dominantPrTicket(prs: PrLink[]): string | null {
  const counts = new Map<string, number>()
  for (const pr of prs) {
    const t = ticketOfPr(pr)
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const [first, second] = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (!first) return null
  return !second || first[1] >= 2 * second[1] ? first[0] : null
}

/**
 * Final ticket ranking for each session: a manual link; else a ticket the
 * session's title names; else the ticket its PR branches agree on; else the
 * transcript scan's best guess.
 */
export function applyLinks(sessions: SessionSummary[]): SessionSummary[] {
  const links = store.links()
  return sessions.map((s) => {
    const prs = s.prs.map(withInfo)
    const manual = links[s.id]
    const fromTitle = s.titleSource === 'custom' || s.titleSource === 'ai' ? ticketsIn(s.title)[0] : undefined
    const fromPrs = dominantPrTicket(prs)

    let primary: string | undefined
    let ticketSource: SessionSummary['ticketSource'] = null
    if (manual) [primary, ticketSource] = [manual, 'manual']
    else if (fromTitle) [primary, ticketSource] = [fromTitle, 'transcript']
    else if (fromPrs) [primary, ticketSource] = [fromPrs, 'pr']
    else if (s.tickets[0]) [primary, ticketSource] = [s.tickets[0], 'transcript']

    const tickets = uniq([...(primary ? [primary] : []), ...s.tickets])
    return { ...s, prs, tickets, ticketSource }
  })
}

/**
 * Waiting Response: a linked session is waiting on you, or the card was put
 * there by hand and none of its sessions has started working since.
 */
function isWaiting(ticket: string, linked: SessionSummary[]): boolean {
  if (linked.some((s) => s.activity?.state === 'waiting')) return true
  const manual = store.waitingSince(ticket)
  if (manual === null) return false
  const workedSince = linked.some((s) => s.activity?.state === 'working' && s.activity.at > manual)
  if (workedSince) {
    // You answered: the hand-set flag has done its job.
    void store.setWaiting(ticket, false)
    return false
  }
  return true
}

const byRecent = (ss: SessionSummary[]) => [...ss].sort((a, b) => b.lastActivity - a.lastActivity).map((s) => s.id)

/** Joins Linear issues with sessions and PRs into board cards. */
export function buildBoard(raw: RawBoard, sessions: SessionSummary[]): Board {
  const cards: BoardCard[] = raw.issues.map((issue) => {
    const linked = sessions.filter((s) => s.tickets[0] === issue.identifier)
    const prs = new Map<string, PrLink>()
    const related: PrLink[] = []
    for (const pr of issue.prs.map(withInfo)) {
      if (namesTicket(pr, issue.identifier)) prs.set(pr.url, pr)
      else related.push(pr)
    }
    // A linked session's PRs belong on the card only if their branch names this
    // ticket; one session often opens PRs for several tickets.
    for (const s of linked) {
      for (const pr of s.prs) if (ticketsIn(pr.info?.headRef).includes(issue.identifier)) prs.set(pr.url, pr)
    }
    // Sessions about other tickets that opened one of this ticket's PRs (attached
    // in Linear, or on a branch naming it). Only for opening the card: they
    // don't make it Waiting or running.
    const opened = (pr: PrLink) => prs.has(pr.url) || ticketsIn(pr.info?.headRef).includes(issue.identifier)
    const viaPr = sessions.filter((s) => s.tickets[0] !== issue.identifier && s.prs.some(opened))
    return {
      issue: { ...issue, prs: issue.prs.map(withInfo) },
      column: columnFor(issue.state, isWaiting(issue.identifier, linked)),
      sessionIds: byRecent(linked),
      prSessionIds: byRecent(viaPr),
      prs: [...prs.values()],
      relatedPrs: related.filter((pr) => !prs.has(pr.url))
    }
  })
  return { cycle: raw.cycle, ...(raw.noCycles && { noCycles: true }), cards }
}
