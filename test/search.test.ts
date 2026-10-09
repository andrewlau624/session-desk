import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { searchTranscripts } from '../src/main/search'
import { tmp, userTurn, writeTranscript } from './helpers'

const A = 'aaaaaaaa-0000-4000-8000-000000000000'
const B = 'bbbbbbbb-0000-4000-8000-000000000000'
const reply = (text: string, timestamp = '2026-10-02T10:00:00.000Z') => ({
  type: 'assistant',
  timestamp,
  message: { role: 'assistant', content: [{ type: 'text', text }, { type: 'tool_use', name: 'Bash', input: { command: 'grep needle' } }] }
})

describe('searchTranscripts', () => {
  it('matches every word in one message, in prompts and replies, not in tool output or reminders', async () => {
    const dir = tmp()
    const projects = join(dir, 'projects')
    writeTranscript(dir, A, [
      userTurn('Why does Greptile miss the rebased commit?'),
      reply('Greptile reviewed 30b4545, which the rebased branch dropped.'),
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'needle in tool output' }] }, toolUseResult: {} },
      userTurn('<system-reminder>needle</system-reminder>')
    ])
    writeTranscript(dir, B, [userTurn('greptile is fine here'), reply('The commit is rebased elsewhere.')], '-other')

    const hits = await searchTranscripts('greptile rebased', projects)
    expect(hits.map((h) => h.sessionId)).toEqual([A])
    expect(hits[0].matches).toBe(2)
    expect(hits[0].snippets.map((s) => s.role)).toEqual(['claude', 'you'])
    expect(await searchTranscripts('needle', projects)).toEqual([])
    expect(await searchTranscripts('GREPTILE', projects)).toHaveLength(2)
  })

  it('ranks by number of matching messages, and picks up new messages', async () => {
    const dir = tmp()
    const projects = join(dir, 'projects')
    const pathA = writeTranscript(dir, A, [userTurn('tooltip once')])
    writeTranscript(dir, B, [userTurn('tooltip one'), reply('tooltip two'), reply('tooltip three')], '-other')
    expect((await searchTranscripts('tooltip', projects)).map((h) => h.sessionId)).toEqual([B, A])

    const more = [reply('tooltip again'), reply('tooltip and again'), reply('tooltip a third time')]
    appendFileSync(pathA, more.map((e) => JSON.stringify({ sessionId: A, ...e })).join('\n') + '\n')
    const hits = await searchTranscripts('tooltip', projects)
    expect(hits[0]).toMatchObject({ sessionId: A, matches: 4 })
    expect(hits[0].snippets).toHaveLength(3)
  })

  it('trims long messages to a snippet around the first word', async () => {
    const dir = tmp()
    writeTranscript(dir, A, [userTurn('x'.repeat(500) + ' the target word ' + 'y'.repeat(500))])
    const [hit] = await searchTranscripts('target', join(dir, 'projects'))
    expect(hit.snippets[0].text).toMatch(/^…x+ the target word y+…$/)
    expect(hit.snippets[0].text.length).toBeLessThan(200)
  })
})
