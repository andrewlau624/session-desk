import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decide, listWorktreesCached, parsePorcelain, pruneWorktrees, REGENERABLE, removeWorktree } from '../src/main/worktrees'
import type { WorktreeInfo } from '../src/shared/types'
import { tmp } from './helpers'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8'
  })

const base = (over: Partial<WorktreeInfo>): Omit<WorktreeInfo, 'verdict' | 'reason'> => ({
  repo: 'r',
  repoPath: '/r',
  path: '/r-wt/eng-1',
  label: 'r-wt/eng-1',
  branch: 'me/eng-1',
  ticket: 'ENG-1',
  missing: false,
  locked: false,
  inUseBy: null,
  changes: 0,
  notableIgnored: [],
  unpushed: 0,
  pushState: 'pr',
  pr: null,
  lastCommitAt: 0,
  createdAt: 0,
  ...over
})

describe('decide', () => {
  const merged = { number: 1, state: 'MERGED' as const, draft: false, url: '' }
  it('anything that would lose work, or is in use, blocks removal', () => {
    expect(decide(base({ pr: merged, changes: 2 })).verdict).toBe('blocked')
    expect(decide(base({ pr: merged, unpushed: 1 })).verdict).toBe('blocked')
    expect(decide(base({ pr: merged, unpushed: null })).verdict).toBe('blocked')
    expect(decide(base({ pr: merged, inUseBy: 'python3.12' })).reason).toBe('In use by python3.12')
    expect(decide(base({ pr: merged, locked: true })).verdict).toBe('blocked')
  })
  it('merged or closed and fully pushed is safe', () => {
    expect(decide(base({ pr: merged }))).toEqual({ verdict: 'safe', reason: 'PR merged' })
    expect(decide(base({ pr: { ...merged, state: 'CLOSED' } })).verdict).toBe('safe')
  })
  it('an open PR or a pushed branch is active, not bulk-safe', () => {
    expect(decide(base({ pr: { ...merged, state: 'OPEN' } })).verdict).toBe('active')
    expect(decide(base({ pushState: 'branch' })).verdict).toBe('active')
  })
  it('a worktree with no commits of its own is safe only once it is old', () => {
    expect(decide(base({ pushState: 'never', createdAt: Date.now() })).verdict).toBe('active')
    expect(decide(base({ pushState: 'never', createdAt: Date.now() - 30 * 86400_000 })).verdict).toBe('safe')
  })
})

describe('ignored files', () => {
  it('build output is regenerable; secrets and local settings are not', () => {
    for (const p of ['node_modules/', '.venv/', 'pkg/__pycache__/', '.next/', 'tsconfig.tsbuildinfo', 'x/y.cpython-312-darwin.so', 'models--Snowflake--arctic/'])
      expect(REGENERABLE.test(p), p).toBe(true)
    for (const p of ['.env', '.env.local', '.claude/settings.local.json', '.entire/logs/', 'dump.rdb'])
      expect(REGENERABLE.test(p), p).toBe(false)
  })
})

describe('parsePorcelain', () => {
  it('reads branches, detached heads and stale entries', () => {
    const text = 'worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r-wt/x\nHEAD bbb\ndetached\n\nworktree /gone\nHEAD ccc\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n'
    expect(parsePorcelain(text)).toEqual([
      { path: '/r', head: 'aaa', branch: 'main', locked: false, prunable: false },
      { path: '/r-wt/x', head: 'bbb', branch: null, locked: false, prunable: false },
      { path: '/gone', head: 'ccc', branch: 'old', locked: false, prunable: true }
    ])
  })
})

describe('listing and removing real worktrees', () => {
  // workspace/api (repo with a local bare remote) and its worktrees in api-wt/.
  const setup = () => {
    // git reports real paths; macOS temp dirs sit behind a /var -> /private/var symlink.
    const root = realpathSync(tmp())
    const ws = join(root, 'ws')
    mkdirSync(ws)
    git(root, 'init', '-q', '--bare', 'remote.git')
    git(ws, 'init', '-q', 'api')
    const repo = join(ws, 'api')
    writeFileSync(join(repo, 'README.md'), 'hi\n')
    writeFileSync(join(repo, '.gitignore'), '.env\nnode_modules/\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'init')
    git(repo, 'remote', 'add', 'origin', join(root, 'remote.git'))
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(repo, 'remote', 'set-head', 'origin', 'main')
    const add = (name: string) => {
      git(repo, 'worktree', 'add', '-q', '-b', `me/${name}`, join(ws, 'api-wt', name), 'origin/main')
      return join(ws, 'api-wt', name)
    }
    return { ws, repo, add }
  }

  it('classifies each case, and removal keeps branches and refuses work', async () => {
    const { ws, repo, add } = setup()
    const pushed = add('eng-9001')
    git(pushed, 'push', '-q', '-u', 'origin', 'me/eng-9001')
    const fresh = add('eng-9002')
    writeFileSync(join(fresh, '.env'), 'SECRET=1\n')
    mkdirSync(join(fresh, 'node_modules'))
    writeFileSync(join(fresh, 'node_modules', 'x.js'), '')
    const unpushed = add('eng-9003')
    writeFileSync(join(unpushed, 'new.txt'), 'x')
    git(unpushed, 'add', 'new.txt')
    git(unpushed, 'commit', '-qm', 'wip')
    const dirty = add('eng-9004')
    writeFileSync(join(dirty, 'README.md'), 'changed\n')
    const gone = add('eng-9005')
    rmSync(gone, { recursive: true })

    const list = await listWorktreesCached(ws)
    const by = (name: string) => list.find((w) => w.path.endsWith(name))!
    expect(list).toHaveLength(5)
    expect(by('eng-9001')).toMatchObject({ verdict: 'active', reason: 'Pushed, no PR', ticket: 'ENG-9001' })
    expect(by('eng-9002')).toMatchObject({ verdict: 'active', reason: 'New, nothing committed yet', notableIgnored: ['.env'] })
    expect(by('eng-9003')).toMatchObject({ verdict: 'blocked', reason: '1 commit never pushed' })
    expect(by('eng-9004')).toMatchObject({ verdict: 'blocked', reason: '1 uncommitted change' })
    expect(by('eng-9005')).toMatchObject({ verdict: 'missing' })

    // Guards: only listed worktrees, never blocked ones, re-checked at removal time.
    await expect(removeWorktree('/somewhere/else')).rejects.toThrow('Refresh the list first')
    await expect(removeWorktree(unpushed)).rejects.toThrow('1 commit never pushed')
    writeFileSync(join(fresh, 'later.txt'), 'x')
    await expect(removeWorktree(fresh)).rejects.toThrow('It has uncommitted changes now')
    rmSync(join(fresh, 'later.txt'))

    await removeWorktree(pushed)
    expect(existsSync(pushed)).toBe(false)
    await removeWorktree(fresh)
    expect(existsSync(fresh)).toBe(false)
    await pruneWorktrees(repo)

    const branches = git(repo, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean)
    expect(branches).toEqual(expect.arrayContaining(['me/eng-9001', 'me/eng-9002', 'me/eng-9003', 'me/eng-9004', 'me/eng-9005']))
    const left = (await listWorktreesCached(ws)).map((w) => w.path)
    expect(left.sort()).toEqual([unpushed, dirty].sort())
  })
})
