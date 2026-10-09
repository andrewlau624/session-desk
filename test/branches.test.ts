import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideBranch, listBranches, removeBranch } from '../src/main/branches'
import { tmp } from './helpers'

const OLD = '2026-01-01T00:00:00Z'
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' })
const gitAt = (cwd: string, date: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date }
  })

const base = {
  repo: 'api',
  repoPath: '/r',
  branch: 'me/eng-1',
  sha: 'a'.repeat(40),
  ticket: 'ENG-1',
  upstream: 'me/eng-1',
  upstreamGone: false,
  checkedOutAt: null,
  pr: null,
  unpushed: 0,
  lastCommitAt: Date.parse(OLD),
  isDefault: false,
  inDefault: false
}
const pr = (state: 'OPEN' | 'MERGED' | 'CLOSED', draft = false) => ({ number: 7, state, draft, url: 'u' })

describe('decideBranch', () => {
  it('a merged or closed PR with every local commit is safe; squash merges are why git alone can’t tell', () => {
    expect(decideBranch({ ...base, pr: pr('MERGED') })).toEqual({ verdict: 'safe', reason: 'PR merged' })
    expect(decideBranch({ ...base, pr: pr('CLOSED') })).toEqual({ verdict: 'safe', reason: 'PR closed' })
  })

  it('commits missing from the PR, or unknown, block it', () => {
    expect(decideBranch({ ...base, pr: pr('MERGED'), unpushed: 2 })).toEqual({ verdict: 'blocked', reason: '2 commits not in PR #7' })
    expect(decideBranch({ ...base, pr: pr('MERGED'), unpushed: null }).verdict).toBe('blocked')
  })

  it('checked out or default: never deleted', () => {
    expect(decideBranch({ ...base, pr: pr('MERGED'), checkedOutAt: 'api-wt/eng-1' })).toEqual({ verdict: 'blocked', reason: 'Checked out at api-wt/eng-1' })
    expect(decideBranch({ ...base, branch: 'main', isDefault: true })).toEqual({ verdict: 'protected', reason: 'Default branch' })
  })

  it('an open PR, or pushed with no PR, is active', () => {
    expect(decideBranch({ ...base, pr: pr('OPEN', true) })).toEqual({ verdict: 'active', reason: 'Draft PR open' })
    expect(decideBranch({ ...base })).toEqual({ verdict: 'active', reason: 'Pushed, no PR' })
  })

  it('without a PR: commits only here block it; all in the default branch is safe once it’s not new', () => {
    expect(decideBranch({ ...base, upstream: null, unpushed: 3 })).toEqual({ verdict: 'blocked', reason: '3 commits only on this Mac' })
    expect(decideBranch({ ...base, upstreamGone: true, unpushed: 1 })).toEqual({ verdict: 'blocked', reason: '1 commit only on this Mac' })
    expect(decideBranch({ ...base, upstream: null, inDefault: true })).toEqual({ verdict: 'safe', reason: 'Already in the default branch' })
    expect(decideBranch({ ...base, upstream: null, inDefault: true, lastCommitAt: Date.now() }).verdict).toBe('active')
    expect(decideBranch({ ...base, upstreamGone: true, inDefault: true, lastCommitAt: Date.now() })).toEqual({
      verdict: 'safe',
      reason: 'In the default branch; deleted on GitHub'
    })
  })
})

describe('listing and deleting real branches', () => {
  const setup = () => {
    const root = realpathSync(tmp())
    const ws = join(root, 'ws')
    mkdirSync(ws)
    git(root, 'init', '-q', '--bare', 'remote.git')
    git(ws, 'init', '-q', 'api')
    const repo = join(ws, 'api')
    writeFileSync(join(repo, 'README.md'), 'hi\n')
    git(repo, 'add', '-A')
    gitAt(repo, OLD, 'commit', '-qm', 'init')
    git(repo, 'remote', 'add', 'origin', join(root, 'remote.git'))
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(repo, 'remote', 'set-head', 'origin', 'main')
    return { ws, repo }
  }

  it('gives each branch a verdict, and deletes only what is safe, re-checked', async () => {
    const { ws, repo } = setup()
    // Old branch fully in main: safe.
    git(repo, 'branch', 'me/old-in-main')
    // Commits only on this Mac: blocked.
    git(repo, 'checkout', '-q', '-b', 'me/local-work')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-qm', 'a')
    git(repo, 'checkout', '-q', 'main')
    // Pushed, no PR: active.
    git(repo, 'checkout', '-q', '-b', 'me/pushed')
    writeFileSync(join(repo, 'b.txt'), 'b\n')
    git(repo, 'add', 'b.txt')
    git(repo, 'commit', '-qm', 'b')
    git(repo, 'push', '-q', '-u', 'origin', 'me/pushed')
    git(repo, 'checkout', '-q', 'main')
    // Checked out in a worktree: blocked.
    git(repo, 'worktree', 'add', '-q', '-b', 'me/eng-42', join(ws, 'api-wt', 'eng-42'), 'origin/main')

    const list = await listBranches(ws)
    const v = Object.fromEntries(list.map((b) => [b.branch, [b.verdict, b.reason]]))
    expect(v).toEqual({
      main: ['protected', 'Default branch'],
      'me/eng-42': ['blocked', 'Checked out at api-wt/eng-42'],
      'me/local-work': ['blocked', '1 commit only on this Mac'],
      'me/old-in-main': ['safe', 'Already in the default branch'],
      'me/pushed': ['active', 'Pushed, no PR']
    })
    expect(list.find((b) => b.branch === 'me/eng-42')?.ticket).toBe('ENG-42')

    // Deleted, and the commit it pointed at comes back for restoring.
    const sha = await removeBranch(repo, 'me/old-in-main')
    expect(git(repo, 'branch', '--list', 'me/old-in-main').trim()).toBe('')
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    // Blocked ones are refused, as are ones not in the last listing.
    await expect(removeBranch(repo, 'me/local-work')).rejects.toThrow('1 commit only on this Mac')
    await expect(removeBranch(repo, 'me/unknown')).rejects.toThrow('Refresh the list first')
    // A branch that moved since the listing is refused.
    git(repo, 'checkout', '-q', 'me/pushed')
    writeFileSync(join(repo, 'c.txt'), 'c\n')
    git(repo, 'add', 'c.txt')
    git(repo, 'commit', '-qm', 'c')
    git(repo, 'checkout', '-q', 'main')
    await expect(removeBranch(repo, 'me/pushed')).rejects.toThrow('new commits since the list was made')
    expect(git(repo, 'branch', '--list', 'me/pushed').trim()).toContain('me/pushed')
  })
})
