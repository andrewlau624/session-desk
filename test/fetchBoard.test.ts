import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBoard } from '../src/main/link'
import { fetchBoard, invalidate, NO_CYCLE_DONE_DAYS, NO_CYCLE_MAX_PAGES } from '../src/main/linear'

vi.mock('../src/main/store', async (importOriginal) => {
  const { store } = await importOriginal<typeof import('../src/main/store')>()
  return { store: Object.assign(Object.create(store), { linearKey: () => 'lin_api_test' }) }
})

const node = (identifier: string, type = 'unstarted', cycle: { number: number; endsAt: string } | null = null) => ({
  id: `id-${identifier}`,
  identifier,
  title: identifier,
  url: `https://linear.app/acme/issue/${identifier}`,
  priorityLabel: 'No priority',
  branchName: identifier.toLowerCase(),
  description: null,
  state: { id: `s-${type}`, name: type, type, color: '#000' },
  team: { id: 'team-eng' },
  cycle,
  attachments: { nodes: [] }
})
const CYCLE = { number: 7, endsAt: '2026-10-20T00:00:00.000Z' }

// Linear's answers, in order; each request is recorded.
let replies: unknown[]
let requests: { query: string; variables: Record<string, unknown> }[]

beforeEach(() => {
  invalidate()
  requests = []
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    requests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ data: replies.shift() }), { status: 200 })
  })
})
afterEach(() => vi.unstubAllGlobals())

const viewer = (teams: { activeCycle: { id: string } | null }[], issues: unknown[]) => ({
  viewer: { teams: { nodes: teams }, assignedIssues: { nodes: issues } }
})

const page = (issues: unknown[], endCursor: string | null = null) => ({
  viewer: { assignedIssues: { nodes: issues, pageInfo: { hasNextPage: endCursor !== null, endCursor } } }
})

describe('fetchBoard', () => {
  it('shows my issues in the active cycle when a team runs cycles', async () => {
    replies = [viewer([{ activeCycle: { id: 'c7' } }], [node('ENG-1', 'started', CYCLE)])]
    const board = await fetchBoard()
    expect(requests).toHaveLength(1)
    expect(board.cycle).toEqual(CYCLE)
    expect(board.noCycles).toBeUndefined()
    expect(board.issues.map((i) => i.identifier)).toEqual(['ENG-1'])
    expect(requests[0].query).toContain('cycle: { isActive: { eq: true } }')
  })

  it('stays empty when cycles run but none of mine are in one (no fallback)', async () => {
    replies = [viewer([{ activeCycle: null }, { activeCycle: { id: 'c7' } }], [])]
    const board = await fetchBoard()
    expect(requests).toHaveLength(1)
    expect(board.issues).toEqual([])
    expect(board.noCycles).toBeUndefined()
  })

  it('falls back to my assigned issues when no team has an active cycle', async () => {
    replies = [
      viewer([{ activeCycle: null }], []),
      page([node('ENG-2'), node('ENG-3', 'completed')])
    ]
    const before = Date.now()
    const board = await fetchBoard()
    expect(requests).toHaveLength(2)
    expect(board).toMatchObject({ cycle: null, noCycles: true })
    expect(board.issues.map((i) => i.identifier)).toEqual(['ENG-2', 'ENG-3'])
    // Finished issues are bounded to the recent window, not every issue ever closed.
    const since = Date.parse(requests[1].variables.since as string)
    expect(before - since).toBeGreaterThanOrEqual(NO_CYCLE_DONE_DAYS * 86_400_000)
    expect(before - since).toBeLessThan(NO_CYCLE_DONE_DAYS * 86_400_000 + 60_000)
    expect(requests[1].query).toContain('completedAt: { gt: $since }')
    expect(requests[1].query).toContain('nin: ["canceled", "duplicate"]')
  })

  it('falls back when I belong to no teams at all', async () => {
    replies = [viewer([], []), page([node('ENG-4')])]
    const board = await fetchBoard()
    expect(board.noCycles).toBe(true)
    expect(board.issues.map((i) => i.identifier)).toEqual(['ENG-4'])
  })

  it('carries the fallback through to the board the window shows', async () => {
    replies = [viewer([{ activeCycle: null }], []), page([node('ENG-5'), node('ENG-6', 'started'), node('ENG-7', 'completed')])]
    const board = buildBoard(await fetchBoard(), [])
    expect(board.noCycles).toBe(true)
    expect(board.cards.map((c) => [c.issue.identifier, c.column])).toEqual([
      ['ENG-5', 'todo'],
      ['ENG-6', 'in_progress'],
      ['ENG-7', 'done']
    ])
    expect('noCycles' in buildBoard({ cycle: CYCLE, issues: [] }, [])).toBe(false)
  })

  it('reads every page of a large backlog, so older active work is not cut off', async () => {
    replies = [viewer([{ activeCycle: null }], []), page([node('ENG-10')], 'c1'), page([node('ENG-11', 'started')], 'c2'), page([node('ENG-12')])]
    const board = await fetchBoard()
    expect(board.issues.map((i) => i.identifier)).toEqual(['ENG-10', 'ENG-11', 'ENG-12'])
    expect(requests.slice(1).map((r) => r.variables.after)).toEqual([null, 'c1', 'c2'])
  })

  it('stops after NO_CYCLE_MAX_PAGES pages', async () => {
    replies = [viewer([{ activeCycle: null }], []), ...Array.from({ length: NO_CYCLE_MAX_PAGES + 2 }, (_, i) => page([node(`ENG-${20 + i}`)], `c${i}`))]
    const board = await fetchBoard()
    expect(requests).toHaveLength(1 + NO_CYCLE_MAX_PAGES)
    expect(board.issues).toHaveLength(NO_CYCLE_MAX_PAGES)
  })

  it('caches nothing when the fallback query fails, and asks again next time', async () => {
    replies = [viewer([{ activeCycle: null }], []), undefined]
    await expect(fetchBoard()).rejects.toThrow()
    replies = [viewer([{ activeCycle: null }], []), page([node('ENG-30')])]
    expect((await fetchBoard()).issues.map((i) => i.identifier)).toEqual(['ENG-30'])
  })

  it('re-decides cycle or fallback after invalidate()', async () => {
    replies = [viewer([{ activeCycle: null }], []), page([node('ENG-40')])]
    expect((await fetchBoard()).noCycles).toBe(true)
    // Cached: no new request.
    await fetchBoard()
    expect(requests).toHaveLength(2)
    invalidate()
    replies = [viewer([{ activeCycle: { id: 'c8' } }], [node('ENG-41', 'started', CYCLE)])]
    const board = await fetchBoard()
    expect(board.noCycles).toBeUndefined()
    expect(board.cycle).toEqual(CYCLE)
  })
})
