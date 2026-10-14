import { appendFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listSessions, parseSession, setTicketKeys } from '../src/main/sessions'
import { tmp, userTurn, writeTranscript } from './helpers'

const ID = '44444444-4444-4444-8444-444444444444'
const line = (entry: object) => JSON.stringify({ sessionId: ID, ...entry }) + '\n'
const reply = (model: string, effort: string, content: object[] = [{ type: 'text', text: 'ok' }]) => ({
  type: 'assistant',
  message: { model, role: 'assistant', content },
  effort
})
const scan = async (dir: string) => (await listSessions({ ownPids: new Set(), includeSdk: true, claudeDir: dir })).find((s) => s.id === ID)

describe('a growing transcript is read on, not re-read', () => {
  setTicketKeys(['ENG'])

  it('reading it in steps gives what reading it whole does', async () => {
    const dir = tmp()
    const path = writeTranscript(dir, ID, [userTurn('fix the login'), reply('claude-sonnet-5-5', 'medium')])
    expect(await scan(dir)).toMatchObject({ title: 'fix the login', model: 'claude-sonnet-5-5' })

    appendFileSync(path, line({ type: 'custom-title', customTitle: 'ENG-8812 login' }))
    appendFileSync(path, line(reply('claude-opus-5-5', 'high', [{ type: 'tool_use', id: 'e1', name: 'Edit', input: {} }])))
    appendFileSync(path, line({ type: 'pr-link', prUrl: 'https://github.com/acme/app/pull/7', prRepository: 'acme/app', prNumber: 7 }))
    appendFileSync(path, line(userTurn('and the logout', { gitBranch: 'me/eng-8813-logout' })))

    const stepped = await scan(dir)
    const whole = await parseSession(path)
    expect(stepped).toMatchObject(whole!)
    expect(stepped).toMatchObject({ title: 'ENG-8812 login', model: 'claude-opus-5-5', effort: 'high', worked: true, tickets: ['ENG-8812', 'ENG-8813'] })
  })

  it('leaves a half-written last line until it is finished', async () => {
    const dir = tmp()
    const path = writeTranscript(dir, ID, [userTurn('first')])
    const half = line(reply('claude-opus-5-5', 'high'))
    appendFileSync(path, half.slice(0, 20))
    expect((await scan(dir))?.model).toBeNull()
    appendFileSync(path, half.slice(20))
    expect((await scan(dir))?.model).toBe('claude-opus-5-5')
  })

  it('reads a replaced, shorter file again from the start', async () => {
    const dir = tmp()
    const path = writeTranscript(dir, ID, [userTurn('a long first prompt here'), reply('claude-opus-5-5', 'high')])
    expect((await scan(dir))?.title).toBe('a long first prompt here')
    writeFileSync(path, line(userTurn('short')))
    expect(await scan(dir)).toMatchObject({ title: 'short', model: null })
  })

  it('counts new lines once when two scans overlap', async () => {
    const dir = tmp()
    const path = writeTranscript(dir, ID, [userTurn('one')])
    await scan(dir)
    appendFileSync(path, line(userTurn('two')) + line(userTurn('three')))
    const [a, b] = await Promise.all([scan(dir), scan(dir)])
    const whole = await parseSession(path)
    expect(a).toMatchObject(whole!)
    expect(b).toMatchObject(whole!)
  })
})
