import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listSessions, parseSession, setTicketKeys, ticketsIn } from '../src/main/sessions'
import { tmp, userTurn, writeTranscript } from './helpers'

const ID = '11111111-1111-4111-8111-111111111111'

describe('ticketsIn', () => {
  it('finds ENG ids in branches, paths and titles, upper-cased', () => {
    expect(ticketsIn('me/eng-8812-login')).toEqual(['ENG-8812'])
    expect(ticketsIn('/work/api-wt/eng-8609/src')).toEqual(['ENG-8609'])
    expect(ticketsIn('ENG-12 and eng-8812')).toEqual(['ENG-12', 'ENG-8812'])
    // Two to six digits: a bare "ENG-1" is too likely to be noise.
    expect(ticketsIn('ENG-1')).toEqual([])
    expect(ticketsIn('space-8812, impact-12, utf-8')).toEqual([])
  })
})

describe('ticket keys from the connected Linear workspace', () => {
  it('detects every team key, and only those', () => {
    expect(setTicketKeys(['OPS', 'eng'])).toBe(true)
    expect(ticketsIn('ops-1234 and ENG-8812, not WEB-77')).toEqual(['OPS-1234', 'ENG-8812'])
    expect(setTicketKeys(['ENG', 'OPS'])).toBe(false)
    setTicketKeys(['ENG'])
    expect(ticketsIn('OPS-1234 ENG-8812')).toEqual(['ENG-8812'])
    // No keys at all keeps the previous ones rather than matching nothing.
    expect(setTicketKeys([])).toBe(false)
  })
})

describe('parseSession', () => {
  it('prefers /rename title, then auto title, then first prompt', async () => {
    const dir = tmp()
    const custom = await parseSession(
      writeTranscript(dir, ID, [
        userTurn('hello there'),
        { type: 'ai-title', aiTitle: 'Auto title' },
        { type: 'custom-title', customTitle: 'my-name' }
      ])
    )
    expect(custom).toMatchObject({ title: 'my-name', titleSource: 'custom' })

    const ai = await parseSession(writeTranscript(dir, ID, [userTurn('hello there'), { type: 'ai-title', aiTitle: 'Auto title' }]))
    expect(ai).toMatchObject({ title: 'Auto title', titleSource: 'ai' })

    const prompt = await parseSession(writeTranscript(dir, ID, [userTurn('  fix   the\nlogin bug ')]))
    expect(prompt).toMatchObject({ title: 'fix the login bug', titleSource: 'prompt' })
  })

  it('skips sessions with no real user turn', async () => {
    const dir = tmp()
    const path = writeTranscript(dir, ID, [
      { type: 'user', isMeta: true, message: { content: 'meta' } },
      { type: 'user', message: { content: '<command-name>/clear</command-name>' } }
    ])
    expect(await parseSession(path)).toBeNull()
  })

  it('collects PRs the session opened, once each', async () => {
    const dir = tmp()
    const link = { type: 'pr-link', prNumber: 365, prUrl: 'https://github.com/o/r/pull/365', prRepository: 'o/r' }
    const s = await parseSession(writeTranscript(dir, ID, [userTurn('go'), link, link]))
    expect(s?.prs).toEqual([{ repo: 'o/r', number: 365, url: 'https://github.com/o/r/pull/365' }])
  })

  it('ranks a ticket in the /rename title above a branch present on every turn', async () => {
    const dir = tmp()
    const turns = Array.from({ length: 40 }, () => userTurn('more', { gitBranch: 'me/eng-8475-image-cache' }))
    const s = await parseSession(writeTranscript(dir, ID, [...turns, { type: 'custom-title', customTitle: 'ENG-8812 tooltip' }]))
    expect(s?.tickets[0]).toBe('ENG-8812')
  })

  it('treats the branch checked out at start as weaker than one switched to', async () => {
    // The repo sat on a stale branch; the session moved to the real one.
    const dir = tmp()
    const s = await parseSession(
      writeTranscript(dir, ID, [
        userTurn('start', { gitBranch: 'me/eng-8475-image-cache' }),
        userTurn('switch', { gitBranch: 'me/eng-8812' })
      ])
    )
    expect(s?.tickets).toEqual(['ENG-8812', 'ENG-8475'])
  })

  it('reads tickets from worktree paths when the branch is HEAD', async () => {
    const dir = tmp()
    const s = await parseSession(
      writeTranscript(dir, ID, [
        userTurn('start'),
        userTurn('in the worktree', { cwd: '/work/acme-app/api-wt/eng-8609', gitBranch: 'HEAD' })
      ])
    )
    expect(s?.tickets).toEqual(['ENG-8609'])
    expect(s?.ticketSource).toBe('transcript')
  })
})

describe('listSessions', () => {
  it('hides SDK runs unless asked, and reports sessions open in another live process', async () => {
    const dir = tmp()
    const cli = '22222222-2222-4222-8222-222222222222'
    const sdk = '33333333-3333-4333-8333-333333333333'
    const dead = '44444444-4444-4444-8444-444444444444'
    writeTranscript(dir, cli, [userTurn('cli one')])
    writeTranscript(dir, sdk, [userTurn('scripted', { entrypoint: 'sdk-cli' })])
    writeTranscript(dir, dead, [userTurn('crashed one')])
    mkdirSync(join(dir, 'sessions'))
    // This test process stands in for a live Claude desktop process.
    writeFileSync(join(dir, 'sessions', '1.json'), JSON.stringify({ pid: process.pid, sessionId: cli, entrypoint: 'claude-desktop' }))
    writeFileSync(join(dir, 'sessions', '2.json'), JSON.stringify({ pid: 2 ** 22 + 7, sessionId: dead, entrypoint: 'cli' }))

    const shown = await listSessions({ ownPids: new Set(), includeSdk: false, claudeDir: dir })
    expect(shown.map((s) => s.id).sort()).toEqual([cli, dead].sort())
    expect(shown.find((s) => s.id === cli)?.liveElsewhere).toEqual({ pid: process.pid, entrypoint: 'claude-desktop' })
    expect(shown.find((s) => s.id === dead)?.liveElsewhere).toBeNull()

    const all = await listSessions({ ownPids: new Set(), includeSdk: true, claudeDir: dir })
    expect(all).toHaveLength(3)

    // A process this app owns is not "elsewhere".
    const own = await listSessions({ ownPids: new Set([process.pid]), includeSdk: false, claudeDir: dir })
    expect(own.find((s) => s.id === cli)?.liveElsewhere).toBeNull()
  })
})

describe('plan and work state (what a move into In Progress picks up from)', () => {
  // Shapes as Claude Code 2.1.29x writes them (measured on a plan-mode probe session).
  const toolUse = (id: string, name: string) => ({
    type: 'assistant',
    sessionId: ID,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] }
  })
  const toolResult = (id: string, content: string, isError?: boolean) => ({
    type: 'user',
    sessionId: ID,
    toolUseResult: {},
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] }
  })
  const parse = (entries: object[]) => parseSession(writeTranscript(tmp(), ID, [userTurn('Plan the work for ENG-8825.'), ...entries]))

  it('a session that only talked has no plan and no work', async () => {
    expect(await parse([toolUse('r1', 'Read'), toolResult('r1', 'file')])).toMatchObject({ plan: 'none', worked: false })
  })

  it('a plan shown but never answered (the session ended at the prompt) is proposed', async () => {
    const interrupted = toolResult('p1', "[Tool call interrupted: the session ended before this call's result was recorded", true)
    expect(await parse([toolUse('p1', 'ExitPlanMode'), interrupted])).toMatchObject({ plan: 'proposed', worked: false })
    expect(await parse([toolUse('p1', 'ExitPlanMode')])).toMatchObject({ plan: 'proposed' })
  })

  it('an approved plan is approved; an edit or a PR means work started', async () => {
    const approved = toolResult('p1', 'User has approved your plan. You can now start coding.')
    expect(await parse([toolUse('p1', 'ExitPlanMode'), approved])).toMatchObject({ plan: 'approved' })
    expect(await parse([toolUse('e1', 'Edit')])).toMatchObject({ plan: 'none', worked: true })
    expect(await parse([{ type: 'pr-link', sessionId: ID, prNumber: 1, prUrl: 'https://github.com/o/r/pull/1', prRepository: 'o/r' }])).toMatchObject({ worked: true })
  })

  it('approval text in some other tool output does not count', async () => {
    // e.g. this very conversation, which quotes the approval message in Bash output.
    const quoted = toolResult('b1', 'User has approved your plan. You can now start coding.')
    expect(await parse([toolUse('p1', 'ExitPlanMode'), toolUse('b1', 'Bash'), quoted])).toMatchObject({ plan: 'proposed' })
  })
})
