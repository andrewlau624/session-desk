import { relative } from 'node:path'
import type { BranchInfo, BranchVerdict } from '../shared/types'
import { ticketsIn } from './sessions'
import { git, mapLimit, NEW_WORKTREE_MS, parsePorcelain, prsForBranches, reposIn, repoName } from './worktrees'

const CONCURRENCY = 6

/**
 * The verdict, most cautious first. Squash merges leave a merged branch
 * "unmerged" to git, so a merged or closed PR that has every local commit is
 * what makes a branch safe; without a PR, only a branch whose commits are all
 * in the default branch is.
 */
export function decideBranch(b: Omit<BranchInfo, 'verdict' | 'reason' | 'sessionIds'> & { isDefault: boolean; inDefault: boolean }): {
  verdict: BranchVerdict
  reason: string
} {
  const n = (k: number, what: string) => `${k} commit${k === 1 ? '' : 's'} ${what}`
  if (b.isDefault) return { verdict: 'protected', reason: 'Default branch' }
  if (b.checkedOutAt) return { verdict: 'blocked', reason: `Checked out at ${b.checkedOutAt}` }
  if (b.unpushed === null) return { verdict: 'blocked', reason: "Couldn't tell whether its commits are anywhere else" }
  if (b.pr) {
    if (b.unpushed > 0) return { verdict: 'blocked', reason: n(b.unpushed, `not in PR #${b.pr.number}`) }
    if (b.pr.state === 'MERGED') return { verdict: 'safe', reason: 'PR merged' }
    if (b.pr.state === 'CLOSED') return { verdict: 'safe', reason: 'PR closed' }
    return { verdict: 'active', reason: b.pr.draft ? 'Draft PR open' : 'PR open' }
  }
  if (b.unpushed > 0) {
    return { verdict: 'blocked', reason: b.upstream && !b.upstreamGone ? n(b.unpushed, 'not pushed') : n(b.unpushed, 'only on this Mac') }
  }
  if (b.inDefault) {
    // A branch just made from main has no commits of its own yet: give it time.
    return Date.now() - b.lastCommitAt < NEW_WORKTREE_MS && !b.upstreamGone
      ? { verdict: 'active', reason: 'New, nothing committed yet' }
      : { verdict: 'safe', reason: b.upstreamGone ? 'In the default branch; deleted on GitHub' : 'Already in the default branch' }
  }
  return { verdict: 'active', reason: 'Pushed, no PR' }
}

// Removal acts only on branches from the last listing, so the UI can never
// point git at an arbitrary ref.
let listed = new Map<string, BranchInfo>()
const key = (repoPath: string, branch: string) => `${repoPath}\0${branch}`

/** Commits on `tip` that `base` doesn't have; null when either isn't here. */
async function onlyIn(dir: string, tip: string, base: string): Promise<number | null> {
  const r = await git(dir, 'rev-list', '--count', `${base}..${tip}`)
  return r.ok ? Number(r.out.trim()) : null
}

/** Every local branch of every repo in the project folder, with its PR and a verdict. */
export async function listBranches(workspace: string): Promise<Omit<BranchInfo, 'sessionIds'>[]> {
  const repos = await reposIn(workspace)
  const perRepo = await mapLimit(repos, 2, async (repo) => {
    const [refs, wts, remote, head] = await Promise.all([
      git(repo, 'for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)', 'refs/heads'),
      git(repo, 'worktree', 'list', '--porcelain'),
      git(repo, 'remote', 'get-url', 'origin'),
      git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
    ])
    const defaultRef = head.ok ? head.out.trim() : 'origin/main'
    const defaultName = defaultRef.replace(/^origin\//, '')
    const slug = /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(remote.out.trim())?.[1] ?? null
    const checkedOut = new Map(
      parsePorcelain(wts.out).flatMap((w) => (w.branch ? [[w.branch, relative(workspace, w.path) || w.path] as const] : []))
    )
    const branches = refs.out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, sha, up, track, ts] = l.split('\0')
        return { name, sha, upstream: up?.startsWith('origin/') ? up.slice(7) : null, gone: track === '[gone]', at: Number(ts) * 1000 || 0 }
      })
    const prs = slug ? await prsForBranches(slug, branches.map((b) => b.name)) : new Map()
    return mapLimit(branches, CONCURRENCY, async (b) => {
      const pr = prs.get(b.name)
      // Where its commits should also be: the PR's head, else its upstream, else the default branch.
      const unpushed = pr
        ? b.sha === pr.headRefOid
          ? 0
          : await onlyIn(repo, b.sha, pr.headRefOid)
        : b.upstream && !b.gone
          ? await onlyIn(repo, b.sha, `refs/remotes/origin/${b.upstream}`)
          : await onlyIn(repo, b.sha, defaultRef)
      const inDefault = (await git(repo, 'merge-base', '--is-ancestor', b.sha, defaultRef)).ok
      const base = {
        repo: repoName(workspace, repo),
        repoPath: repo,
        branch: b.name,
        sha: b.sha,
        ticket: ticketsIn(b.name)[0] ?? null,
        upstream: b.upstream,
        upstreamGone: b.gone,
        checkedOutAt: checkedOut.get(b.name) ?? null,
        pr: pr ? { number: pr.number, state: pr.state, draft: pr.draft, url: pr.url } : null,
        unpushed,
        lastCommitAt: b.at
      }
      return { ...base, ...decideBranch({ ...base, isDefault: b.name === defaultName, inDefault }) }
    })
  })
  const all = perRepo.flat()
  listed = new Map(all.map((b) => [key(b.repoPath, b.branch), { ...b, sessionIds: [] }]))
  return all
}

/**
 * Deletes a listed branch after re-checking: still safe or active (never
 * blocked or protected), its tip unchanged, and not checked out now. `-D`
 * because squash merges leave merged branches "unmerged" to git; the checks
 * above are what make it safe. Resolves with the commit it pointed at
 * (`git branch <name> <sha>` brings it back; git keeps it ~90 days).
 */
export async function removeBranch(repoPath: string, branch: string): Promise<string> {
  const b = listed.get(key(repoPath, branch))
  if (!b) throw new Error('Refresh the list first')
  if (b.verdict === 'blocked' || b.verdict === 'protected') throw new Error(b.reason)
  const tip = await git(repoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)
  if (!tip.ok || tip.out.trim() !== b.sha) throw new Error('It has new commits since the list was made; refresh first')
  const wts = await git(repoPath, 'worktree', 'list', '--porcelain')
  if (parsePorcelain(wts.out).some((w) => w.branch === branch)) throw new Error('It is checked out now')
  const r = await git(repoPath, 'branch', '-D', '--', branch)
  if (!r.ok) throw new Error(r.err.trim() || `git refused to delete ${branch}`)
  listed.delete(key(repoPath, branch))
  return b.sha
}
