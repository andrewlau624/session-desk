import { beforeEach, describe, expect, it } from 'vitest'
import type { LinearIssue, PrLink } from '../src/shared/types'
import { tmp, pr, session } from './helpers'

// The store keeps its file under userData; give each run a clean one.
process.env.SESSION_DESK_TEST_USERDATA = tmp()

const { applyLinks, buildBoard, ticketOfPr } = await import('../src/main/link')
const { columnFor, setLinearTicketsOfPr, stateForColumn } = await import('../src/main/linear')
const { store } = await import('../src/main/store')

const A = '0000000a-0000-4000-8000-000000000000'

describe('applyLinks: which ticket a session is about', () => {
  beforeEach(async () => {
    await store.setLink(A, null)
  })

  it('a manual link wins over everything', async () => {
    await store.setLink(A, 'ENG-1111')
    const [s] = applyLinks([session({ id: A, title: 'ENG-2222 work', tickets: ['ENG-3333'], prs: [pr(1, 'me/eng-4444')] })])
    expect(s.tickets[0]).toBe('ENG-1111')
    expect(s.ticketSource).toBe('manual')
  })

  it('a ticket in the title beats PR branches', () => {
    const [s] = applyLinks([session({ id: A, title: 'ENG-8232 PR status', prs: [pr(1, 'me/eng-8614')] })])
    expect(s.tickets[0]).toBe('ENG-8232')
  })

  it('PR branches win when they agree', () => {
    // The "PR 9186 and 812" case: transcript guessed a stale branch.
    const [s] = applyLinks([session({ id: A, title: 'PR 9186 and 812 CI errors', tickets: ['ENG-8475'], prs: [pr(1, 'me/eng-8609')] })])
    expect(s.tickets).toEqual(['ENG-8609', 'ENG-8475'])
    expect(s.ticketSource).toBe('pr')
  })

  it('PR branches are ignored when no ticket dominates', () => {
    // A long session that opened one PR each for many tickets.
    const prs = [pr(1, 'me/eng-1001'), pr(2, 'me/eng-1002'), pr(3, 'me/eng-1003')]
    const [s] = applyLinks([session({ id: A, title: 'Long session', tickets: ['ENG-8812'], prs })])
    expect(s.tickets[0]).toBe('ENG-8812')
    expect(s.ticketSource).toBe('transcript')
  })

  it('a ticket with twice the PRs of the next dominates', () => {
    const prs = [pr(1, 'me/eng-1001'), pr(2, 'me/eng-1001-b'), pr(3, 'me/eng-1002')]
    const [s] = applyLinks([session({ id: A, title: 'x', prs })])
    expect(s.tickets[0]).toBe('ENG-1001')
  })
})

const issue = (identifier: string, name: string, type: string): LinearIssue & { teamId: string } => ({
  id: identifier,
  identifier,
  title: identifier,
  url: '',
  priorityLabel: '',
  branchName: '',
  description: '',
  teamId: 't',
  prs: [],
  state: { id: name, name, type, color: '' }
})

describe('board columns', () => {
  it('maps ENG workflow states onto the five columns', () => {
    expect(columnFor({ name: 'Todo', type: 'unstarted' }, false)).toBe('todo')
    expect(columnFor({ name: 'Backlog', type: 'backlog' }, false)).toBe('todo')
    expect(columnFor({ name: 'In Progress', type: 'started' }, false)).toBe('in_progress')
    expect(columnFor({ name: 'In Progress', type: 'started' }, true)).toBe('waiting')
    expect(columnFor({ name: 'In Review', type: 'started' }, true)).toBe('in_review')
    expect(columnFor({ name: 'Done', type: 'completed' }, true)).toBe('done')
  })

  it('maps columns back to the Linear state a drag should set', () => {
    const states = [
      { id: 'cold', name: 'Cold', type: 'backlog', position: 0 },
      { id: 'todo', name: 'Todo', type: 'unstarted', position: 1 },
      { id: 'prog', name: 'In Progress', type: 'started', position: 2 },
      { id: 'rev', name: 'In Review', type: 'started', position: 3 },
      { id: 'done', name: 'Done', type: 'completed', position: 4 }
    ]
    expect(stateForColumn(states, 'todo')?.id).toBe('todo')
    expect(stateForColumn(states, 'in_progress')?.id).toBe('prog')
    // Waiting Response is app-side: Linear stays In Progress.
    expect(stateForColumn(states, 'waiting')?.id).toBe('prog')
    expect(stateForColumn(states, 'in_review')?.id).toBe('rev')
    expect(stateForColumn(states, 'done')?.id).toBe('done')
  })
})

describe('Waiting Response', () => {
  const raw = {
    cycle: null,
    issues: [issue('ENG-1', 'In Progress', 'started'), issue('ENG-2', 'In Review', 'started'), issue('ENG-3', 'Todo', 'unstarted')]
  }
  const now = Math.floor(Date.now() / 1000)
  const linked = (ticket: string, activity: { state: 'working' | 'waiting'; at: number } | null) =>
    session({ id: crypto.randomUUID(), tickets: [ticket], activity: activity && { ...activity, event: 'Stop' } })
  const col = (sessions: ReturnType<typeof session>[], id = 'ENG-1') => buildBoard(raw, sessions).cards.find((c) => c.issue.identifier === id)!.column

  beforeEach(async () => {
    await store.setWaiting('ENG-1', false)
  })

  it('an In Progress ticket moves to Waiting while one of its sessions waits', () => {
    expect(col([linked('ENG-1', { state: 'working', at: now })])).toBe('in_progress')
    expect(col([linked('ENG-1', { state: 'waiting', at: now })])).toBe('waiting')
    expect(col([linked('ENG-1', { state: 'working', at: now }), linked('ENG-1', { state: 'waiting', at: now })])).toBe('waiting')
  })

  it('other Linear states stay put, and closed sessions do not count', () => {
    expect(col([linked('ENG-2', { state: 'waiting', at: now })], 'ENG-2')).toBe('in_review')
    expect(col([linked('ENG-3', { state: 'waiting', at: now })], 'ENG-3')).toBe('todo')
    expect(col([linked('ENG-1', null)])).toBe('in_progress')
  })

  it('a hand-dragged card waits until one of its sessions works again', async () => {
    await store.setWaiting('ENG-1', true)
    const since = store.waitingSince('ENG-1')!
    expect(col([linked('ENG-1', null)])).toBe('waiting')
    expect(col([linked('ENG-1', { state: 'working', at: since - 5 })])).toBe('waiting')
    expect(col([linked('ENG-1', { state: 'working', at: since + 1 })])).toBe('in_progress')
    expect(store.waitingSince('ENG-1')).toBeNull()
  })
})

describe('opening a card without a session of its own', () => {
  // The ENG-8814 case: its PR was opened from a long session about another ticket.
  const done = { ...issue('ENG-8814', 'Done', 'completed'), prs: [pr(9198, 'me/eng-8814')] }
  const card = (sessions: ReturnType<typeof session>[], i = done) => buildBoard({ cycle: null, issues: [i] }, sessions).cards[0]
  const box = session({ id: 'box', title: 'Long session', tickets: ['ENG-8475'], lastActivity: 5, prs: [pr(9144, 'me/eng-8475'), pr(9198, 'me/eng-8814')] })

  it('records the session that opened its Linear-attached PR', () => {
    const c = card([box, session({ id: 'other', tickets: ['ENG-8475'], prs: [pr(9144, 'me/eng-8475')] })])
    expect(c.sessionIds).toEqual([])
    expect(c.prSessionIds).toEqual(['box'])
  })

  it('also finds it by branch when the PR is not attached in Linear', () => {
    expect(card([box], { ...done, prs: [] }).prSessionIds).toEqual(['box'])
  })

  it("does not list the ticket's own sessions twice, and those don't make it waiting", () => {
    const own = session({ id: 'own', tickets: ['ENG-8814'], prs: [pr(9198, 'me/eng-8814')] })
    const waitingBox = { ...box, activity: { state: 'waiting' as const, at: 1, event: 'Stop' } }
    const ip = { ...issue('ENG-8814', 'In Progress', 'started'), prs: [pr(9198, 'me/eng-8814')] }
    const c = card([own, waitingBox], ip)
    expect(c.sessionIds).toEqual(['own'])
    expect(c.prSessionIds).toEqual(['box'])
    expect(c.column).toBe('in_progress')
  })
})

describe("a ticket's own PRs vs ones attached for context", () => {
  // The ENG-8825 case: #9207 (Remove old banner) caused the bug and is attached as a reference.
  const withMentions = (n: number, headRef: string, mentions: string[], state: 'OPEN' | 'MERGED' = 'MERGED') => {
    const p = pr(n, headRef, state)
    return { ...p, info: { ...p.info!, mentions } }
  }
  const card = (prs: PrLink[], sessions: ReturnType<typeof session>[] = []) =>
    buildBoard({ cycle: null, issues: [{ ...issue('ENG-8825', 'Todo', 'unstarted'), prs }] }, sessions).cards[0]

  it('an attached PR that names another ticket is related, not the ticket\'s own', () => {
    const c = card([withMentions(9207, 'sam/remove-banner', [])])
    expect(c.prs).toEqual([])
    expect(c.relatedPrs.map((p) => p.number)).toEqual([9207])
  })

  it('naming the ticket in the branch, title or description makes it its own', () => {
    // mentions covers all three; the description is the "Fixes ENG-8825" case.
    const c = card([withMentions(9300, 'sam/stale-filter', ['ENG-8825']), withMentions(9207, 'sam/remove-banner', ['ENG-8501'])])
    expect(c.prs.map((p) => p.number)).toEqual([9300])
    expect(c.relatedPrs.map((p) => p.number)).toEqual([9207])
  })

  it('counts as its own until GitHub has answered', () => {
    const unknown = { repo: 'acme/api', number: 9207, url: 'https://github.com/acme/api/pull/9207' }
    expect(card([unknown]).prs).toHaveLength(1)
  })

  it('a session that opened only a related PR is not where the ticket was worked on', () => {
    const banner = session({ id: 'banner', tickets: ['ENG-8501'], prs: [withMentions(9207, 'sam/remove-banner', [])] })
    expect(card([withMentions(9207, 'sam/remove-banner', [])], [banner]).prSessionIds).toEqual([])
  })
})

describe('a PR on a branch that names no ticket', () => {
  // The export-cleanup case: Sam's #8655 (feat/csv-export), taken over in a session
  // started in a checkout that happened to be on me/eng-8475-image-cache.
  const takeover = (prTickets: string[] | null, mentions: string[] = ['ENG-7995', 'ENG-8002']) => {
    const p = pr(8655, 'feat/csv-export', 'OPEN')
    const withUrl = { ...p, url: `https://github.com/acme/api/pull/${8655 + (prTickets?.length ?? 9)}`, info: { ...p.info!, mentions } }
    if (prTickets) setLinearTicketsOfPr(withUrl.url, prTickets)
    return applyLinks([session({ id: A, title: 'export-cleanup', titleSource: 'custom', tickets: ['ENG-8475'], prs: [withUrl] })])[0]
  }

  it("takes the issue it's attached to in Linear over the folder's leftover branch", () => {
    const s = takeover(['ENG-8372'])
    expect(s.tickets[0]).toBe('ENG-8372')
    expect(s.ticketSource).toBe('pr')
  })

  it('attached to several, takes the one the PR names', () => {
    expect(takeover(['ENG-8372', 'ENG-8002']).tickets[0]).toBe('ENG-8002')
  })

  it("falls back to the transcript when Linear doesn't know the PR", () => {
    expect(takeover(null).tickets[0]).toBe('ENG-8475')
    expect(takeover([]).ticketSource).toBe('transcript')
  })

  it("a ticket in the branch still wins over Linear's attachments", () => {
    const p = { ...pr(77, 'me/eng-1234'), url: 'https://github.com/o/r/pull/77' }
    setLinearTicketsOfPr(p.url, ['ENG-9999'])
    expect(ticketOfPr(p)).toBe('ENG-1234')
  })
})
