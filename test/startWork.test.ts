import { describe, expect, it } from 'vitest'
import { kickoffFor, startWork, startWorkNotice } from '../src/renderer/src/startWork'
import type { BoardCard, LinearIssue } from '../src/shared/types'
import { session } from './helpers'

const card = (sessionIds: string[], prSessionIds: string[] = []): BoardCard => ({
  issue: { identifier: 'ENG-8825' } as LinearIssue,
  column: 'todo',
  sessionIds,
  prSessionIds,
  prs: [],
  relatedPrs: []
})
const waiting = (event: string) => ({ state: 'waiting' as const, at: 1, event })

describe('moving a card into In Progress', () => {
  it('starts a new planning session when the ticket has none of its own', () => {
    expect(startWork(card([]), [], new Set())).toEqual({ kind: 'new' })
    // A session that only opened its PR is about another ticket.
    expect(startWork(card([], ['box']), [session({ id: 'box' })], new Set()).kind).toBe('new')
  })

  it('resumes a closed session where it left off', () => {
    const at = (over: Parameters<typeof session>[0]) => startWork(card(['s']), [session({ id: 's', ...over })], new Set())
    expect(at({})).toMatchObject({ kind: 'resume', kickoff: 'replan' })
    expect(at({ plan: 'proposed' })).toMatchObject({ kind: 'resume', kickoff: 'represent' })
    expect(at({ plan: 'approved' })).toMatchObject({ kind: 'resume', kickoff: 'continue' })
    expect(at({ worked: true })).toMatchObject({ kind: 'resume', kickoff: 'continue' })
  })

  it('types into a session open here only when it sits idle at its prompt', () => {
    const open = (activity: ReturnType<typeof session>['activity']) =>
      startWork(card(['s']), [session({ id: 's', plan: 'approved', activity })], new Set(['s']))
    expect(open(null)).toMatchObject({ kind: 'type', kickoff: 'continue' })
    expect(open(waiting('Stop'))).toMatchObject({ kind: 'type' })
    // A dialog is open: typing would answer it.
    expect(open(waiting('PermissionRequest'))).toMatchObject({ kind: 'leave', reason: 'needs-you' })
    expect(open(waiting('Notification'))).toMatchObject({ kind: 'leave', reason: 'needs-you' })
    expect(open({ state: 'working', at: 1, event: 'PostToolUse' })).toMatchObject({ kind: 'leave', reason: 'working' })
  })

  it('leaves a session open in another app alone', () => {
    const s = session({ id: 's', liveElsewhere: { pid: 1, entrypoint: 'cli' } })
    const plan = startWork(card(['s']), [s], new Set())
    expect(plan).toMatchObject({ kind: 'leave', reason: 'elsewhere' })
    expect(startWorkNotice('ENG-8825', plan)).toBe("ENG-8825's session is open in cli; continue it there")
  })

  it('picks the most recent of the ticket’s sessions (sessionIds order)', () => {
    const plan = startWork(card(['new', 'old']), [session({ id: 'old', worked: true }), session({ id: 'new' })], new Set())
    expect(plan).toMatchObject({ kind: 'resume', session: { id: 'new' }, kickoff: 'replan' })
  })

  it('kickoffFor: approval or edits mean continue', () => {
    expect(kickoffFor({ plan: 'proposed', worked: true })).toBe('continue')
  })
})
