import type { Column, LinearIssue, LinearStatus, PrLink } from '../shared/types'
import { parsePrUrl } from './github'
import { workspace as projectFolder } from './paths'
import { store } from './store'

const ENDPOINT = 'https://api.linear.app/graphql'
const BOARD_TTL_MS = 20_000
const ISSUE_TTL_MS = 60_000

interface State {
  id: string
  name: string
  type: string
  position: number
}

export interface RawBoard {
  cycle: { number: number; endsAt: string } | null
  issues: (LinearIssue & { teamId: string })[]
}

export class NotConnectedError extends Error {}

// Which issues each PR is attached to in Linear. A PR on a branch that names
// no ticket (someone else's, say) is still tied to one when it's attached.
const PR_TICKETS_TTL_MS = 10 * 60_000
const PR_TICKETS_BATCH = 20
const prTickets = new Map<string, { at: number; tickets: string[] }>()
const prTicketsInFlight = new Set<string>()

/** Issues the PR is attached to in Linear; undefined until asked (or without Linear). */
export function linearTicketsOfPr(url: string): string[] | undefined {
  return prTickets.get(url)?.tickets
}

/** For tests: what Linear would say. */
export function setLinearTicketsOfPr(url: string, tickets: string[]): void {
  prTickets.set(url, { at: Date.now(), tickets })
}

/** Asks Linear which issues the PRs are attached to. Resolves true if anything changed. */
export async function refreshPrTickets(prs: PrLink[]): Promise<boolean> {
  if (!store.linearKey(projectFolder())) return false
  const todo = [...new Set(prs.map((p) => p.url))].filter((u) => {
    const hit = prTickets.get(u)
    return !prTicketsInFlight.has(u) && (!hit || Date.now() - hit.at > PR_TICKETS_TTL_MS)
  })
  if (!todo.length) return false
  todo.forEach((u) => prTicketsInFlight.add(u))
  let changed = false
  try {
    for (let i = 0; i < todo.length; i += PR_TICKETS_BATCH) {
      const chunk = todo.slice(i, i + PR_TICKETS_BATCH)
      const vars = Object.fromEntries(chunk.map((u, j) => [`u${j}`, u]))
      const d = await gql<Record<string, { nodes: { issue: { identifier: string } | null }[] }>>(
        `query(${chunk.map((_, j) => `$u${j}: String!`).join(', ')}) { ${chunk
          .map((_, j) => `a${j}: attachmentsForURL(url: $u${j}) { nodes { issue { identifier } } }`)
          .join(' ')} }`,
        vars
      )
      chunk.forEach((u, j) => {
        const tickets = [...new Set((d[`a${j}`]?.nodes ?? []).flatMap((n) => (n.issue ? [n.issue.identifier] : [])))]
        const before = prTickets.get(u)?.tickets.join(' ')
        prTickets.set(u, { at: Date.now(), tickets })
        if (before !== tickets.join(' ')) changed = true
      })
    }
  } catch {
    // Not connected, or Linear refused: the branch rules still apply.
  } finally {
    todo.forEach((u) => prTicketsInFlight.delete(u))
  }
  return changed
}

const ISSUE_FIELDS = `
  id identifier title url priorityLabel branchName description
  state { id name type color }
  team { id }
  cycle { number endsAt }
  attachments(first: 15) { nodes { url } }
`

// The current project's connection: each project folder has its own Linear key.
async function gql<T>(query: string, variables: Record<string, unknown> = {}, key = store.linearKey(projectFolder())): Promise<T> {
  if (!key) throw new NotConnectedError('Linear is not connected')
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    // Personal API keys go in the header as-is, without "Bearer".
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables })
  })
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null
  if (!res.ok || body?.errors?.length || !body?.data) {
    throw new Error(body?.errors?.[0]?.message ?? `Linear API returned ${res.status}`)
  }
  return body.data
}

function toIssue(n: any): LinearIssue & { teamId: string } {
  return {
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    url: n.url,
    priorityLabel: n.priorityLabel,
    branchName: n.branchName,
    description: n.description ?? '',
    state: n.state,
    teamId: n.team.id,
    prs: n.attachments.nodes.map((a: { url: string }) => parsePrUrl(a.url)).filter(Boolean)
  }
}

export async function linearStatus(key?: string): Promise<LinearStatus> {
  try {
    const d = await gql<{
      viewer: { name: string; displayName: string; organization: { urlKey: string } }
      teams: { nodes: { key: string }[] }
    }>('query { viewer { name displayName organization { urlKey } } teams(first: 100) { nodes { key } } }', {}, key ?? store.linearKey(projectFolder()))
    // `name` is often just the email address when no full name was set.
    const { name, displayName } = d.viewer
    const workspace = { urlKey: d.viewer.organization.urlKey, teamKeys: d.teams.nodes.map((t) => t.key).sort() }
    return { connected: true, viewer: name.includes('@') ? displayName : name, workspace }
  } catch (e) {
    return {
      connected: false,
      error: e instanceof NotConnectedError ? undefined : String((e as Error).message),
      workspace: store.linearWorkspace(projectFolder())
    }
  }
}

let boardCache: { at: number; board: RawBoard } | null = null
const issueCache = new Map<string, { at: number; issue: LinearIssue | null }>()
const statesCache = new Map<string, State[]>()

export function invalidate(): void {
  boardCache = null
  issueCache.clear()
}

/** Another project (and so maybe another Linear workspace): forget everything learned from the last one. */
export function resetLinear(): void {
  invalidate()
  statesCache.clear()
  prTickets.clear()
}

/** My issues in the active cycle, excluding canceled and duplicate ones. */
export async function fetchBoard(): Promise<RawBoard> {
  if (boardCache && Date.now() - boardCache.at < BOARD_TTL_MS) return boardCache.board
  const d = await gql<{ viewer: { assignedIssues: { nodes: any[] } } }>(`
    query {
      viewer {
        assignedIssues(
          first: 100
          filter: {
            cycle: { isActive: { eq: true } }
            state: { type: { nin: ["canceled", "duplicate"] } }
          }
        ) { nodes { ${ISSUE_FIELDS} } }
      }
    }`)
  const nodes = d.viewer.assignedIssues.nodes
  const board: RawBoard = { cycle: nodes.find((n) => n.cycle)?.cycle ?? null, issues: nodes.map(toIssue) }
  boardCache = { at: Date.now(), board }
  return board
}

export async function fetchIssue(identifier: string): Promise<LinearIssue | null> {
  const hit = issueCache.get(identifier)
  if (hit && Date.now() - hit.at < ISSUE_TTL_MS) return hit.issue
  let issue: LinearIssue | null = null
  try {
    // `issue(id:)` accepts the human identifier (ENG-123) as well as the uuid.
    const d = await gql<{ issue: any }>(`query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id: identifier })
    issue = toIssue(d.issue)
  } catch (e) {
    if (e instanceof NotConnectedError) throw e
    // Unknown identifier (a ticket mentioned in a transcript that doesn't exist).
  }
  issueCache.set(identifier, { at: Date.now(), issue })
  return issue
}

async function teamStates(teamId: string): Promise<State[]> {
  const hit = statesCache.get(teamId)
  if (hit) return hit
  const d = await gql<{ team: { states: { nodes: State[] } } }>(
    `query($id: String!) { team(id: $id) { states(first: 50) { nodes { id name type position } } } }`,
    { id: teamId }
  )
  const states = [...d.team.states.nodes].sort((a, b) => a.position - b.position)
  statesCache.set(teamId, states)
  return states
}

/** Board column for a Linear state. "In Review" is a started state, told apart by name. */
export function columnFor(state: { type: string; name: string }, waiting: boolean): Column {
  if (state.type === 'completed') return 'done'
  if (state.type === 'started') {
    if (/review/i.test(state.name)) return 'in_review'
    return waiting ? 'waiting' : 'in_progress'
  }
  return 'todo'
}

export function stateForColumn(states: State[], column: Column): State | undefined {
  const started = states.filter((s) => s.type === 'started')
  switch (column) {
    case 'todo':
      return states.find((s) => s.type === 'unstarted')
    case 'in_progress':
    case 'waiting':
      // Waiting Response is an app-side overlay on top of Linear's In Progress.
      return started.find((s) => /progress/i.test(s.name)) ?? started.find((s) => !/review/i.test(s.name))
    case 'in_review':
      return started.find((s) => /review/i.test(s.name))
    case 'done':
      return states.find((s) => s.type === 'completed')
  }
}

/** Linear's own GitHub-driven moves for a team (event -> state), so the app doesn't duplicate them. */
export async function gitAutomations(teamId: string): Promise<{ event: string; state: string }[]> {
  const d = await gql<{ team: { gitAutomationStates: { nodes: { event: string; state: { name: string } | null }[] } } }>(
    `query($id: String!) { team(id: $id) { gitAutomationStates(first: 20) { nodes { event state { name } } } } }`,
    { id: teamId }
  )
  return d.team.gitAutomationStates.nodes.filter((n) => n.state).map((n) => ({ event: n.event, state: n.state!.name }))
}

export async function moveIssue(issue: { id: string; identifier: string; teamId: string; state: { id: string } }, column: Column): Promise<void> {
  const target = stateForColumn(await teamStates(issue.teamId), column)
  if (!target) throw new Error(`The team has no workflow state for "${column}"`)
  if (target.id !== issue.state.id) {
    const d = await gql<{ issueUpdate: { success: boolean } }>(
      `mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`,
      { id: issue.id, stateId: target.id }
    )
    if (!d.issueUpdate.success) throw new Error('Linear rejected the status change')
  }
  await store.setWaiting(issue.identifier, column === 'waiting')
  invalidate()
}
