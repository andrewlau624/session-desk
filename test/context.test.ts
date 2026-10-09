import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openablePath, ticketContext } from '../src/main/context'
import { tmp } from './helpers'

function fixture() {
  const root = realpathSync(tmp())
  const ws = join(root, 'acme-app')
  const projects = join(root, 'claude', 'projects')
  const ev = join(ws, 'evidence')
  for (const d of ['ENG-8609/screens', 'eng-8029', 'PR-9107', 'ENG-86090', 'misc-captures']) mkdirSync(join(ev, d), { recursive: true })
  writeFileSync(join(ev, 'ENG-8609', 'a.txt'), 'x')
  writeFileSync(join(ev, 'ENG-8609', 'screens', 'b.png'), 'x')
  writeFileSync(join(ev, 'ENG-8609', 'run.command'), '#!/bin/sh\n')

  const mem = (project: string, name: string, body: string) => {
    mkdirSync(join(projects, project, 'memory'), { recursive: true })
    writeFileSync(join(projects, project, 'memory', name), body)
  }
  const note = (name: string, desc: string, body: string) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`
  mem('-Users-me-Development-acme-app', 'eng-8609-cache-plan.md', note('eng-8609-cache-plan', 'Cache status', 'PRs pushed.'))
  mem('-Users-me-Development-acme-app', 'cache-ttl.md', note('cache-ttl', 'Cache TTL is too short', 'Seen on ENG-8609 and ENG-8609 again.'))
  mem('-Users-me-Development-acme-app', 'unrelated.md', note('unrelated', 'other', 'ENG-86090 is a different ticket.'))
  mem('-Users-me-Development-acme-app', 'MEMORY.md', '- [x](eng-8609-cache-plan.md) ENG-8609')
  mem('-Users-me-Development-acme-app-api', 'server-note.md', note('server-note', 'from the server project', 'eng 8609 mention'))
  mem('-private-tmp-scratch', 'scratch.md', note('scratch', 'test junk', 'ENG-8609'))
  mem('-Users-me-Development-acme-app', 'quoted.md', note('quoted', '"the \\"TTL\\" is in seconds"', 'ENG-7777'))
  return { ws, projects, ev }
}

describe('ticketContext', () => {
  it("finds the ticket's evidence (any case) and its PRs' evidence, not look-alikes", async () => {
    const { ws, projects } = fixture()
    const ctx = await ticketContext(ws, 'ENG-8609', [9107], projects)
    expect(ctx.evidence.map((e) => e.label).sort()).toEqual(['evidence/ENG-8609', 'evidence/PR-9107'])
    expect(ctx.evidence.find((e) => e.label === 'evidence/ENG-8609')?.files).toBe(3)
    expect((await ticketContext(ws, 'ENG-8029', [], projects)).evidence.map((e) => e.label)).toEqual(['evidence/eng-8029'])
  })

  it('lists memory notes mentioning the ticket, named ones first, skipping the index and scratch projects', async () => {
    const { ws, projects } = fixture()
    const { notes } = await ticketContext(ws, 'ENG-8609', [], projects)
    expect(notes.map((n) => n.name)).toEqual(['eng-8609-cache-plan', 'cache-ttl', 'server-note'])
    expect(notes[1]).toMatchObject({ description: 'Cache TTL is too short', mentions: 2, project: 'acme-app' })
    expect(notes[2].project).toBe('acme-app-api')
  })

  it('with no ticket, still finds PR evidence and no notes', async () => {
    const { ws, projects } = fixture()
    expect(await ticketContext(ws, null, [9107], projects)).toMatchObject({ evidence: [{ label: 'evidence/PR-9107' }], notes: [] })
  })
})

it('unescapes quoted YAML descriptions', async () => {
  const { ws, projects } = fixture()
  const { notes } = await ticketContext(ws, 'ENG-7777', [], projects)
  expect(notes[0].description).toBe('the "TTL" is in seconds')
})

describe('openablePath', () => {
  it('opens evidence folders and memory notes, and nothing that could run', async () => {
    const { ws, projects, ev } = fixture()
    const notePath = join(projects, '-Users-me-Development-acme-app', 'memory', 'cache-ttl.md')
    expect(await openablePath(ws, join(ev, 'ENG-8609'), projects)).toBe('folder')
    expect(await openablePath(ws, notePath, projects)).toBe('note')
    expect(await openablePath(ws, join(ev, 'ENG-8609', 'run.command'), projects)).toBeNull()
    expect(await openablePath(ws, '/bin/ls', projects)).toBeNull()
    expect(await openablePath(ws, ev, projects)).toBeNull()
    writeFileSync(join(ws, 'README.md'), '# not a memory note')
    expect(await openablePath(ws, join(ws, 'README.md'), projects)).toBeNull()
    // A symlink inside evidence/ pointing out of it is judged by its target.
    symlinkSync('/Applications', join(ev, 'escape'))
    expect(await openablePath(ws, join(ev, 'escape'), projects)).toBeNull()
    expect(await openablePath(ws, join(ev, 'missing'), projects)).toBeNull()
  })
})
