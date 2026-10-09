import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localOf, refreshLocalSync } from '../src/main/sync'
import type { PrLink } from '../src/shared/types'
import { tmp } from './helpers'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    encoding: 'utf8'
  }).trim()

const commit = (cwd: string, file: string) => {
  writeFileSync(join(cwd, file), file)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-qm', file)
  return git(cwd, 'rev-parse', 'HEAD')
}

const openPr = (n: number, headRef: string, headOid: string, state: 'OPEN' | 'MERGED' = 'OPEN'): PrLink => ({
  repo: 'acme/api',
  number: n,
  url: `https://github.com/acme/api/pull/${n}`,
  info: {
    title: '',
    state,
    draft: false,
    headRef,
    status: { headOid, readyAt: '2026-10-08T00:00:00Z', checks: 'none', review: null, unresolvedThreads: 0, greptile: { state: 'none' } }
  }
})

describe('local checkout vs PR head', () => {
  it('reports unpushed and newer-on-GitHub commits, and admits when it cannot tell', async () => {
    const ws = join(realpathSync(tmp()), 'ws')
    mkdirSync(ws)
    git(ws, 'init', '-q', 'api')
    const repo = join(ws, 'api')
    // Never pushed: the slug is all that matters for matching PRs to checkouts.
    git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/api.git')
    const base = commit(repo, 'a')

    const wt = (branch: string) => {
      const path = join(ws, 'api-wt', branch.replace('/', '-'))
      git(repo, 'worktree', 'add', '-q', '-b', branch, path, base)
      return path
    }
    wt('me/in-sync')
    const ahead = wt('me/ahead')
    commit(ahead, 'b')
    commit(ahead, 'c')
    const behind = wt('me/behind')
    // The PR has a commit this worktree doesn't (made on a side branch here, so it exists locally).
    git(behind, 'checkout', '-q', '-b', 'side')
    const newer = commit(behind, 'd')
    git(behind, 'checkout', '-q', 'me/behind')
    wt('me/unfetched')

    const prs = [
      openPr(1, 'me/in-sync', base),
      openPr(2, 'me/ahead', base),
      openPr(3, 'me/behind', newer),
      openPr(4, 'me/unfetched', 'f'.repeat(40)),
      openPr(5, 'me/no-checkout', base),
      openPr(6, 'me/ahead', base, 'MERGED')
    ]
    expect(await refreshLocalSync(ws, prs, true)).toBe(true)

    expect(localOf(prs[0].url)).toEqual({ worktree: 'api-wt/me-in-sync', ahead: 0, behind: 0 })
    expect(localOf(prs[1].url)).toEqual({ worktree: 'api-wt/me-ahead', ahead: 2, behind: 0 })
    expect(localOf(prs[2].url)).toEqual({ worktree: 'api-wt/me-behind', ahead: 0, behind: 1 })
    expect(localOf(prs[3].url)).toEqual({ worktree: 'api-wt/me-unfetched', ahead: null, behind: null })
    expect(localOf(prs[4].url)).toBeUndefined()
    // Merged PRs are the worktree view's business.
    expect(localOf(prs[5].url)).toBeUndefined()

    // Nothing changed: a second pass reports no change.
    expect(await refreshLocalSync(ws, prs, true)).toBe(false)
    // Pushing (here: the PR head catching up) clears the warning.
    const pushed = git(ahead, 'rev-parse', 'HEAD')
    expect(await refreshLocalSync(ws, [openPr(2, 'me/ahead', pushed)], true)).toBe(true)
    expect(localOf(prs[1].url)).toMatchObject({ ahead: 0, behind: 0 })
  })
})
