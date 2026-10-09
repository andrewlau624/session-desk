import { describe, expect, it } from 'vitest'
import { planMoves } from '../src/main/autoMove'
import type { LinearIssue, PrLink } from '../src/shared/types'
import { session } from './helpers'

const ENABLED = Date.parse('2026-10-08T12:00:00Z')
const after = Math.floor(ENABLED / 1000) + 60
const before = Math.floor(ENABLED / 1000) - 60

const issue = (identifier: string, name: string, type: string): LinearIssue & { teamId: string } => ({
  id: identifier, identifier, title: identifier, url: '', priorityLabel: '', branchName: '', description: '', teamId: 't', prs: [],
  state: { id: name, name, type, color: '' }
})
const board = (...issues: ReturnType<typeof issue>[]) => ({ cycle: null, issues })
const working = (ticket: string, at: number) => session({ id: crypto.randomUUID(), title: `${ticket} work`, tickets: [ticket], activity: { state: 'working', at, event: 'UserPromptSubmit' } })
const openPr = (n: number, readyAt: string, draft = false): PrLink => ({
  repo: 'acme/api', number: n, url: `u${n}`,
  info: { title: '', state: 'OPEN', draft, headRef: 'b', status: { headOid: 'x', readyAt, checks: 'none', review: null, unresolvedThreads: 0, greptile: { state: 'none' } } }
})
const plan = (o: Partial<Parameters<typeof planMoves>[0]>) =>
  planMoves({ board: board(), sessions: [], prs: () => [], since: { start: ENABLED, review: ENABLED }, done: () => false, ...o })

describe('To Do → In Progress when a session starts working', () => {
  it('moves a To Do ticket once a linked session works after the rule was enabled', () => {
    const moves = plan({ board: board(issue('ENG-1', 'Todo', 'unstarted')), sessions: [working('ENG-1', after)] })
    expect(moves).toEqual([{ ticket: 'ENG-1', rule: 'start', to: 'in_progress', because: 'a session started working: ENG-1 work' }])
  })
  it('ignores work from before enabling, rules that are off, and tickets already moved once', () => {
    expect(plan({ board: board(issue('ENG-1', 'Todo', 'unstarted')), sessions: [working('ENG-1', before)] })).toEqual([])
    expect(plan({ board: board(issue('ENG-1', 'Todo', 'unstarted')), sessions: [working('ENG-1', after)], since: {} })).toEqual([])
    // You moved it back by hand: leave it.
    expect(plan({ board: board(issue('ENG-1', 'Todo', 'unstarted')), sessions: [working('ENG-1', after)], done: () => true })).toEqual([])
  })
  it('never moves tickets that are past To Do', () => {
    for (const [name, type] of [['In Progress', 'started'], ['In Review', 'started'], ['Done', 'completed'], ['Canceled', 'canceled'], ['Duplicate', 'duplicate'], ['Triage', 'triage']])
      expect(plan({ board: board(issue('ENG-1', name, type)), sessions: [working('ENG-1', after)] }), name).toEqual([])
  })
})

describe('In Progress → In Review when a PR opens', () => {
  const inProgress = board(issue('ENG-2', 'In Progress', 'started'))
  it('moves on a reviewable PR opened after enabling', () => {
    expect(plan({ board: inProgress, prs: () => [openPr(9202, '2026-10-08T13:00:00Z')] })).toEqual([
      { ticket: 'ENG-2', rule: 'review', to: 'in_review', because: 'PR api#9202 opened' }
    ])
  })
  it('not for drafts, PRs that were already open, merged PRs, or rules that are off', () => {
    expect(plan({ board: inProgress, prs: () => [openPr(1, '2026-10-08T13:00:00Z', true)] })).toEqual([])
    expect(plan({ board: inProgress, prs: () => [openPr(1, '2026-10-07T13:00:00Z')] })).toEqual([])
    const merged = { ...openPr(1, '2026-10-08T13:00:00Z'), info: { ...openPr(1, '').info!, state: 'MERGED' as const } }
    expect(plan({ board: inProgress, prs: () => [merged] })).toEqual([])
    expect(plan({ board: inProgress, prs: () => [openPr(1, '2026-10-08T13:00:00Z')], since: { start: ENABLED } })).toEqual([])
  })
  it('never moves tickets in To Do, In Review or Done', () => {
    for (const [name, type] of [['Todo', 'unstarted'], ['In Review', 'started'], ['Done', 'completed']])
      expect(plan({ board: board(issue('ENG-2', name, type)), prs: () => [openPr(1, '2026-10-08T13:00:00Z')] }), name).toEqual([])
  })
})
