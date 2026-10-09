import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listArtifacts } from '../src/main/artifacts'
import { tmp, userTurn, writeTranscript } from './helpers'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const ART = 'https://claude.ai/code/artifact/1b158c10-5d72-45c5-99f5-22105d92ea46'
const DOC = 'https://claude.ai/artifact/7rKBrDEaedJY1n3UQb1W82'

let n = 0
const call = (name: string, input: object, result: string, timestamp: string) => {
  const id = `toolu_${++n}`
  return [
    { type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name, input }] } },
    { type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: result }] }] }, toolUseResult: {} }
  ]
}

describe('listArtifacts', () => {
  it('collects published and opened artifacts per session, merged by link', async () => {
    const dir = tmp()
    writeTranscript(dir, A, [
      userTurn('make the report'),
      ...call('Artifact', { file_path: '/tmp/x/quarterly-metrics.html', description: 'First draft' }, `Published to ${ART}`, '2026-09-11T10:00:00Z'),
      ...call('Artifact', { file_path: '/tmp/x/quarterly-metrics.html', description: 'The five slowest endpoints (ENG-7673)' }, `Updated ${ART}`, '2026-09-12T10:00:00Z'),
      // A link only mentioned in tool output isn't an artifact this session made.
      ...call('Bash', { command: 'grep artifact' }, `found https://claude.ai/code/artifact/ffffffff-0000-4000-8000-000000000000`, '2026-09-12T11:00:00Z')
    ])
    writeTranscript(dir, B, [
      userTurn('look at it'),
      ...call('Artifact', { action: 'open', url: ART }, `Opened. Also at ${DOC}`, '2026-09-13T10:00:00Z'),
      ...call('mcp__docs__batch', { container: { kind: 'project', create: { name: 'Team Handbook' } } }, `created ${DOC}`, '2026-09-14T10:00:00Z')
    ], '-other')

    const ticketOf = (id: string) => (id === B ? 'ENG-8609' : null)
    const all = await listArtifacts(ticketOf, join(dir, 'projects'))
    expect(all.map((a) => a.url)).toEqual([DOC, ART])

    const report = all[1]
    expect(report).toMatchObject({
      title: 'quarterly metrics',
      description: 'The five slowest endpoints (ENG-7673)',
      published: true,
      sessions: [
        { id: A, kind: 'publish' },
        { id: B, kind: 'open' }
      ],
      tickets: ['ENG-7673', 'ENG-8609']
    })
    expect(all[0]).toMatchObject({ title: 'Team Handbook', published: true, sessions: [{ id: B, kind: 'publish' }] })
  })
})
