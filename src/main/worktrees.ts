import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { TicketBranch, WorktreeInfo, WorktreeVerdict } from '../shared/types'
import { loginPath } from './env'
import { mapLimit } from './mapLimit'
import { ticketsIn } from './sessions'

const CONCURRENCY = 6

// Ignored paths that are safe to lose with a worktree: caches, environments
// and build output that any checkout regenerates. Anything else ignored (.env,
// local settings, logs) is named in the confirmation before removal.
export const REGENERABLE =
  /(^|\/)(node_modules|\.venv|venv|__pycache__|\.pytest_cache|\.ruff_cache|\.mypy_cache|\.hypothesis|\.next|\.turbo|\.cache|coverage|dist|build|out|htmlcov|\.tox|models--[^/]+)\/?$|\.(tsbuildinfo|so|coverage)$|(^|\/)next-env\.d\.ts$/

// A worktree this new with no commits of its own is probably about to be used.
export const NEW_WORKTREE_MS = 14 * 24 * 3600_000

interface RunResult {
  ok: boolean
  out: string
  err: string
}

export async function run(cmd: string, args: string[], cwd?: string): Promise<RunResult> {
  const env = { ...process.env, PATH: await loginPath(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  return new Promise((resolve) =>
    execFile(cmd, args, { cwd, env, timeout: 60_000, maxBuffer: 32 << 20 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout ?? ''), err: String(stderr ?? '') })
    )
  )
}

export const git = (dir: string, ...args: string[]) => run('git', ['-C', dir, ...args])

export { mapLimit }

interface RawWorktree {
  path: string
  head: string
  branch: string | null
  locked: boolean
  prunable: boolean
}

export function parsePorcelain(text: string): RawWorktree[] {
  const list: RawWorktree[] = []
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean)
    const path = lines.find((l) => l.startsWith('worktree '))?.slice(9)
    if (!path) continue
    list.push({
      path,
      head: lines.find((l) => l.startsWith('HEAD '))?.slice(5) ?? '',
      branch: lines.find((l) => l.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '') ?? null,
      locked: lines.some((l) => l.startsWith('locked')),
      prunable: lines.some((l) => l.startsWith('prunable'))
    })
  }
  return list
}

/**
 * The project's repos: the project folder itself when it's a repo, otherwise
 * the repos directly under it (not worktrees: those have a .git file).
 */
export async function reposIn(workspace: string): Promise<string[]> {
  if ((await fs.stat(join(workspace, '.git')).catch(() => null))?.isDirectory()) return [workspace]
  const names = await fs.readdir(workspace).catch(() => [] as string[])
  const repos: string[] = []
  for (const n of names) {
    const st = await fs.stat(join(workspace, n, '.git')).catch(() => null)
    if (st?.isDirectory()) repos.push(join(workspace, n))
  }
  return repos
}

/** A repo's display name: its path under the project folder, or its folder name when it is the project. */
export const repoName = (workspace: string, repo: string): string => relative(workspace, repo) || basename(repo)

/** A worktree's path for display: relative to the folder holding its repo, where ticket worktrees go. */
const worktreeLabel = (repo: string, path: string): string => {
  const base = dirname(repo)
  return path.startsWith(base + sep) ? relative(base, path) : path
}

/** Which process (if any) has its working directory inside each path. */
async function cwdUsers(): Promise<{ path: string; command: string }[]> {
  const r = await run('lsof', ['-n', '-d', 'cwd', '-Fcn'])
  const users: { path: string; command: string }[] = []
  let command = ''
  for (const line of r.out.split('\n')) {
    if (line.startsWith('c')) command = line.slice(1)
    else if (line.startsWith('n')) users.push({ path: line.slice(1), command })
  }
  return users
}

export interface PrRef {
  number: number
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  draft: boolean
  url: string
  headRefOid: string
}

/** The most relevant PR per branch (open, else merged, else closed), batched per repo. */
export async function prsForBranches(slug: string, branches: string[]): Promise<Map<string, PrRef>> {
  const found = new Map<string, PrRef>()
  const [owner, name] = slug.split('/')
  const NAME_RE = /^[\w.-]+$/
  if (!NAME_RE.test(owner ?? '') || !NAME_RE.test(name ?? '') || branches.length === 0) return found
  for (let i = 0; i < branches.length; i += 30) {
    const chunk = branches.slice(i, i + 30)
    const fields = chunk
      .map(
        (b, j) =>
          `b${j}:pullRequests(headRefName:${JSON.stringify(b)},first:5,states:[OPEN,MERGED,CLOSED],orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number state isDraft url headRefOid}}`
      )
      .join(' ')
    const r = await run('gh', ['api', 'graphql', '-f', `query=query{r:repository(owner:"${owner}",name:"${name}"){${fields}}}`])
    let data: any = null
    try {
      data = JSON.parse(r.out)?.data?.r
    } catch {
      continue
    }
    chunk.forEach((b, j) => {
      const nodes: any[] = data?.[`b${j}`]?.nodes ?? []
      const rank = (s: string) => (s === 'OPEN' ? 0 : s === 'MERGED' ? 1 : 2)
      const best = [...nodes].sort((x, y) => rank(x.state) - rank(y.state))[0]
      if (best) {
        found.set(b, { number: best.number, state: best.state, draft: best.isDraft, url: best.url, headRefOid: best.headRefOid })
      }
    })
  }
  return found
}

async function aheadOf(dir: string, ref: string): Promise<number | null> {
  const r = await git(dir, 'rev-list', '--count', `${ref}..HEAD`)
  return r.ok ? Number(r.out.trim()) : null
}

export function decide(w: Omit<WorktreeInfo, 'verdict' | 'reason'>): { verdict: WorktreeVerdict; reason: string } {
  if (w.missing) return { verdict: 'missing', reason: 'Folder no longer exists' }
  if (w.inUseBy) return { verdict: 'blocked', reason: `In use by ${w.inUseBy}` }
  if (w.locked) return { verdict: 'blocked', reason: 'Locked' }
  if (w.changes > 0) return { verdict: 'blocked', reason: `${w.changes} uncommitted change${w.changes > 1 ? 's' : ''}` }
  if (w.unpushed === null) return { verdict: 'blocked', reason: "Couldn't tell whether its commits are pushed" }
  if (w.unpushed > 0) {
    return {
      verdict: 'blocked',
      reason: `${w.unpushed} commit${w.unpushed > 1 ? 's' : ''} ${w.pushState === 'never' ? 'never pushed' : 'not pushed'}`
    }
  }
  if (w.pr?.state === 'MERGED') return { verdict: 'safe', reason: 'PR merged' }
  if (w.pr?.state === 'CLOSED') return { verdict: 'safe', reason: 'PR closed' }
  if (w.pr) return { verdict: 'active', reason: w.pr.draft ? 'Draft PR open' : 'PR open' }
  if (w.pushState === 'never') {
    return Date.now() - w.createdAt < NEW_WORKTREE_MS
      ? { verdict: 'active', reason: 'New, nothing committed yet' }
      : { verdict: 'safe', reason: 'No commits of its own' }
  }
  return { verdict: 'active', reason: 'Pushed, no PR' }
}

/** Every extra worktree of every repo under the workspace, with what removing it would lose. */
export async function listWorktrees(workspace: string): Promise<WorktreeInfo[]> {
  const [repos, users] = await Promise.all([reposIn(workspace), cwdUsers()])
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const [list, remote, head] = await Promise.all([
        git(repo, 'worktree', 'list', '--porcelain'),
        git(repo, 'remote', 'get-url', 'origin'),
        git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
      ])
      const slug = /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(remote.out.trim())?.[1] ?? ''
      // The first entry is the main checkout itself.
      const extra = parsePorcelain(list.out).slice(1)
      const prs = slug ? await prsForBranches(slug, [...new Set(extra.flatMap((w) => (w.branch ? [w.branch] : [])))]) : new Map()
      return { repo, slug, defaultRef: head.ok ? head.out.trim() : 'origin/main', extra, prs }
    })
  )

  const jobs = perRepo.flatMap((r) => r.extra.map((w) => ({ ...r, w })))
  return mapLimit(jobs, CONCURRENCY, async ({ repo, defaultRef, prs, w }) => {
    const exists = !w.prunable && (await fs.stat(w.path).catch(() => null)) !== null
    const pr: PrRef | undefined = w.branch ? prs.get(w.branch) : undefined
    let changes = 0
    let notableIgnored: string[] = []
    let unpushed: number | null = 0
    let pushState: WorktreeInfo['pushState'] = 'pr'
    let lastCommitAt = 0
    let createdAt = 0
    if (exists) {
      // A linked worktree's `.git` is a file git writes once, when the worktree is added.
      createdAt = (await fs.stat(join(w.path, '.git')).catch(() => null))?.birthtimeMs ?? 0
      const [status, log] = await Promise.all([
        git(w.path, 'status', '--porcelain', '--ignored', '--untracked-files=normal'),
        git(w.path, 'log', '-1', '--format=%ct')
      ])
      const lines = status.out.split('\n').filter(Boolean)
      changes = status.ok ? lines.filter((l) => !l.startsWith('!! ')).length : 1
      notableIgnored = lines
        .filter((l) => l.startsWith('!! '))
        .map((l) => l.slice(3))
        .filter((p) => !REGENERABLE.test(p))
      lastCommitAt = Number(log.out.trim()) * 1000 || 0
      // Squash merges leave a merged branch off main, so "pushed" means: no
      // local commits past what the PR (or remote branch) last had.
      const remoteBranch = w.branch ? `refs/remotes/origin/${w.branch}` : null
      const hasRemote = remoteBranch ? (await git(w.path, 'rev-parse', '--verify', '--quiet', remoteBranch)).ok : false
      if (pr) {
        unpushed = w.head === pr.headRefOid ? 0 : ((await aheadOf(w.path, pr.headRefOid)) ?? (hasRemote ? await aheadOf(w.path, remoteBranch!) : null))
        pushState = 'pr'
      } else if (hasRemote) {
        unpushed = await aheadOf(w.path, remoteBranch!)
        pushState = 'branch'
      } else {
        unpushed = await aheadOf(w.path, defaultRef)
        pushState = 'never'
      }
    }
    const inside = (p: string) => p === w.path || p.startsWith(w.path + sep)
    const base: Omit<WorktreeInfo, 'verdict' | 'reason'> = {
      repo: repoName(workspace, repo),
      repoPath: repo,
      path: w.path,
      label: worktreeLabel(repo, w.path),
      head: w.head,
      branch: w.branch,
      ticket: ticketsIn(w.branch ?? '')[0] ?? ticketsIn(w.path)[0] ?? null,
      missing: !exists,
      locked: w.locked,
      inUseBy: exists ? (users.find((u) => inside(u.path))?.command ?? null) : null,
      changes,
      notableIgnored,
      unpushed,
      pushState,
      pr: pr ? { number: pr.number, state: pr.state, draft: pr.draft, url: pr.url } : null,
      lastCommitAt,
      createdAt
    }
    return { ...base, ...decide(base) }
  })
}

/**
 * The checkouts working on a ticket: any worktree (or main checkout) whose
 * branch names it, or whose folder does (`<repo>-wt/eng-1234`), or that is on
 * one of the ticket's PR branches (`prHeads`, by repo slug) or tracks one:
 * a PR taken over from someone else rarely names the ticket. Local git only,
 * no GitHub calls, so the session view can ask on every refresh.
 */
export async function ticketBranches(
  workspace: string,
  ticket: string,
  prHeads: { repo: string; branch: string }[] = []
): Promise<TicketBranch[]> {
  const repos = await reposIn(workspace)
  const found = await mapLimit(repos, CONCURRENCY, async (repo) => {
    const [list, remote, refs] = await Promise.all([
      git(repo, 'worktree', 'list', '--porcelain'),
      git(repo, 'remote', 'get-url', 'origin'),
      // Every local branch and what it tracks, in one call.
      git(repo, 'for-each-ref', '--format=%(refname:short) %(upstream:short)', 'refs/heads')
    ])
    const slug = /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(remote.out.trim())?.[1] ?? null
    const upstreams = new Map(
      refs.out
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split(' ') as [string, string?])
        .filter(([, u]) => u?.startsWith('origin/'))
        .map(([b, u]) => [b, u!.slice('origin/'.length)])
    )
    const heads = new Set(prHeads.filter((h) => slug && h.repo.toLowerCase() === slug.toLowerCase()).map((h) => h.branch))
    return parsePorcelain(list.out)
      .filter((w) => {
        if (!w.branch || w.prunable) return false
        const named = (ticketsIn(w.branch)[0] ?? ticketsIn(relative(repo, w.path))[0] ?? ticketsIn(w.path)[0]) === ticket
        const upstream = upstreams.get(w.branch)
        return named || heads.has(w.branch) || (!!upstream && heads.has(upstream))
      })
      .map((w) => ({ repo, slug, w, upstream: upstreams.get(w.branch!) ?? null }))
  })
  return mapLimit(found.flat(), CONCURRENCY, async ({ repo, slug, w, upstream }) => {
    const branch = w.branch!
    // Its upstream if set, else a same-named branch on origin.
    const remoteName = upstream ?? branch
    const [head, status, onOrigin] = await Promise.all([
      git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'),
      git(w.path, 'status', '--porcelain', '--untracked-files=normal'),
      git(w.path, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${remoteName}`)
    ])
    const defaultRef = head.ok ? head.out.trim() : 'origin/main'
    const ahead = await aheadOf(w.path, defaultRef)
    return {
      repo: repoName(workspace, repo),
      branch,
      label: worktreeLabel(repo, w.path),
      slug,
      defaultBranch: defaultRef.replace(/^origin\//, ''),
      pushed: onOrigin.ok,
      remoteBranch: onOrigin.ok && remoteName !== branch ? remoteName : null,
      unpushed: onOrigin.ok ? await aheadOf(w.path, `refs/remotes/origin/${remoteName}`) : ahead,
      ahead,
      changes: status.ok ? status.out.split('\n').filter(Boolean).length : 0
    }
  })
}

// The last listing. Removal acts only on worktrees from it, so the UI can
// never point git at an arbitrary path.
let listed = new Map<string, WorktreeInfo>()

export async function listWorktreesCached(workspace: string): Promise<WorktreeInfo[]> {
  const all = await listWorktrees(workspace)
  listed = new Map(all.map((w) => [w.path, w]))
  return all
}

/**
 * Removes a listed worktree after re-checking it: still clean, nothing
 * running in it. Then `git worktree remove` without --force, which itself
 * refuses uncommitted or untracked changes and locked worktrees. The branch
 * is kept.
 */
export async function removeWorktree(path: string, deleteBranch = false): Promise<{ branchDeleted: boolean }> {
  const w = listed.get(path)
  if (!w) throw new Error('Refresh the list first')
  if (w.verdict === 'blocked' || w.verdict === 'missing') throw new Error(w.reason)
  const status = await git(w.path, 'status', '--porcelain', '--untracked-files=normal')
  if (!status.ok || status.out.trim()) throw new Error('It has uncommitted changes now')
  const inside = (p: string) => p === w.path || p.startsWith(w.path + sep)
  const user = (await cwdUsers()).find((u) => inside(u.path))
  if (user) throw new Error(`In use by ${user.command}`)
  const r = await git(w.repoPath, 'worktree', 'remove', w.path)
  if (!r.ok) throw new Error(r.err.trim() || `git refused to remove ${w.label}`)
  listed.delete(path)
  // Its branch too, only when that loses nothing: its PR is merged or closed
  // (the verdict already required every commit to be in it), and the branch
  // still points where the worktree was.
  const finished = w.verdict === 'safe' && (w.pr?.state === 'MERGED' || w.pr?.state === 'CLOSED')
  if (!deleteBranch || !w.branch || !finished) return { branchDeleted: false }
  const tip = await git(w.repoPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${w.branch}`)
  if (!tip.ok || tip.out.trim() !== w.head) return { branchDeleted: false }
  const d = await git(w.repoPath, 'branch', '-D', '--', w.branch)
  return { branchDeleted: d.ok }
}

/** Clears git's records of worktrees whose folders are gone; touches no files. */
export async function pruneWorktrees(repoPath: string): Promise<void> {
  if (![...listed.values()].some((w) => w.repoPath === repoPath && w.missing)) throw new Error('Nothing to prune')
  const r = await git(repoPath, 'worktree', 'prune')
  if (!r.ok) throw new Error(r.err.trim() || 'git worktree prune failed')
}
