import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openablePath, ticketContext } from '../src/main/context'
import { CONFIG_NAME, loadProjectConfig } from '../src/main/projectConfig'
import { ticketBrief, worktreePath } from '../src/main/ticketBrief'
import { reposIn, ticketBranches } from '../src/main/worktrees'
import { tmp } from './helpers'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' })
const issue = { identifier: 'ENG-42', title: 'Fix it', url: '', branchName: 'me/eng-42', description: 'd' }

afterEach(async () => {
  // Back to the defaults for other tests.
  await loadProjectConfig(null)
})

describe('worktree layout', () => {
  it('fills {repo} and {ticket} (lower-case)', () => {
    expect(worktreePath('{repo}-wt/{ticket}', 'api', 'ENG-42')).toBe('api-wt/eng-42')
    expect(worktreePath('worktrees/{repo}/{ticket}', 'api', 'ENG-42')).toBe('worktrees/api/eng-42')
  })

  it('a folder of repos: Claude picks the repos, each worktree at the layout', () => {
    const b = ticketBrief(issue, '/work/acme', { layout: 'trees/{repo}/{ticket}', singleRepo: false })
    expect(b).toContain('/work/acme holds several git repositories side by side')
    expect(b).toContain('use the worktree at /work/acme/trees/REPO/eng-42 on branch me/eng-42')
    expect(b).toContain('git -C /work/acme/REPO worktree add -b me/eng-42 /work/acme/trees/REPO/eng-42 origin/<default branch>')
  })

  it('a project that is one repo: its worktree goes beside it, not inside it', () => {
    const b = ticketBrief(issue, '/work/api', { layout: '{repo}-wt/{ticket}', singleRepo: true })
    expect(b).toContain('This project is the git repository at /work/api.')
    expect(b).toContain('Use the worktree at /work/api-wt/eng-42 on branch me/eng-42')
    expect(b).toContain('git -C /work/api worktree add -b me/eng-42 /work/api-wt/eng-42 origin/<default branch>')
    expect(b).not.toContain('side by side')
  })
})

describe('a single-repo project folder (real git)', () => {
  it('is its own repo, and its ticket worktree beside it is found', async () => {
    const root = realpathSync(tmp())
    const repo = join(root, 'api')
    git(root, 'init', '-q', 'api')
    writeFileSync(join(repo, 'README.md'), 'hi\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'init')
    // Tickets are recognised by the Linear team keys (ENG until Linear says otherwise).
    git(repo, 'worktree', 'add', '-q', '-b', 'me/eng-42', join(root, 'api-wt', 'eng-42'))
    expect(await reposIn(repo)).toEqual([repo])
    const found = await ticketBranches(repo, 'ENG-42')
    expect(found.map((b) => [b.repo, b.branch, b.label])).toEqual([['api', 'me/eng-42', 'api-wt/eng-42']])
  })
})

describe('the ticket context folder', () => {
  const project = async (config: object | null) => {
    const ws = realpathSync(tmp())
    for (const d of ['evidence/ENG-42', 'notes/eng-42']) mkdirSync(join(ws, d), { recursive: true })
    if (config) writeFileSync(join(ws, CONFIG_NAME), JSON.stringify(config))
    await loadProjectConfig(ws)
    return ws
  }
  const projects = realpathSync(tmp())

  it('is evidence/ by default, and whatever contextFolder names', async () => {
    let ws = await project(null)
    expect((await ticketContext(ws, 'ENG-42', [], projects)).evidence.map((e) => e.label)).toEqual(['evidence/ENG-42'])
    ws = await project({ contextFolder: 'notes' })
    expect((await ticketContext(ws, 'ENG-42', [], projects)).evidence.map((e) => e.label)).toEqual(['notes/eng-42'])
    // Only the configured folder opens from the panel.
    expect(await openablePath(ws, join(ws, 'notes', 'eng-42'), projects)).toBe('folder')
    expect(await openablePath(ws, join(ws, 'evidence', 'ENG-42'), projects)).toBeNull()
  })

  it('null turns it off', async () => {
    const ws = await project({ contextFolder: null })
    expect((await ticketContext(ws, 'ENG-42', [], projects)).evidence).toEqual([])
    expect(await openablePath(ws, join(ws, 'evidence', 'ENG-42'), projects)).toBeNull()
  })
})
