import { execFile } from 'node:child_process'
import { relative, sep } from 'node:path'
import type { LocalSync, PrLink } from '../shared/types'
import { loginPath } from './env'
import { parsePorcelain, reposIn } from './worktrees'

const MIN_INTERVAL_MS = 15_000
const GITHUB_SLUG_RE = /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/

const byUrl = new Map<string, LocalSync>()
// Counts depend only on the two commits, so they are kept per pair.
const counts = new Map<string, { ahead: number | null; behind: number | null }>()
// Every PR seen so far (sessions' and board cards'), newest snapshot of each.
const known = new Map<string, PrLink>()
let lastRun = 0
let running: Promise<boolean> | null = null

async function git(dir: string, ...args: string[]): Promise<{ ok: boolean; out: string }> {
  const env = { ...process.env, PATH: await loginPath(), GIT_OPTIONAL_LOCKS: '0' }
  return new Promise((resolve) =>
    execFile('git', ['-C', dir, ...args], { env, timeout: 20_000 }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? '') }))
  )
}

/** Cached comparison for an open PR, if one has been made. */
export function localOf(url: string): LocalSync | undefined {
  return byUrl.get(url)
}

/**
 * Compares each open PR's head on GitHub with the local checkout of its
 * branch: commits ahead were never pushed. Throttled; resolves true when
 * anything changed.
 */
export function refreshLocalSync(workspace: string, prs: PrLink[], force = false): Promise<boolean> {
  for (const p of prs) if (p.info) known.set(p.url, p)
  if (running) return running
  // Until PR details have loaded there is nothing to compare; don't let that
  // count as a run, or the first real comparison waits out the interval.
  const ready = [...known.values()].some((p) => p.info?.state === 'OPEN' && p.info.status?.headOid)
  if (!ready) return Promise.resolve(false)
  if (!force && Date.now() - lastRun < MIN_INTERVAL_MS) return Promise.resolve(false)
  lastRun = Date.now()
  running = compare(workspace, [...known.values()]).finally(() => (running = null))
  return running
}

async function compare(workspace: string, prs: PrLink[]): Promise<boolean> {
  const open = prs.filter((p) => p.info?.state === 'OPEN' && p.info.status?.headOid && p.info.headRef)
  // slug -> branch -> { path, head }
  const checkouts = new Map<string, Map<string, { path: string; head: string }>>()
  for (const repo of await reposIn(workspace)) {
    const [remote, list] = await Promise.all([git(repo, 'remote', 'get-url', 'origin'), git(repo, 'worktree', 'list', '--porcelain')])
    const slug = GITHUB_SLUG_RE.exec(remote.out.trim())?.[1]
    if (!slug) continue
    const branches = new Map<string, { path: string; head: string }>()
    for (const w of parsePorcelain(list.out)) if (w.branch && !w.prunable) branches.set(w.branch, { path: w.path, head: w.head })
    checkouts.set(slug.toLowerCase(), branches)
  }

  let changed = false
  const seen = new Set<string>()
  for (const pr of open) {
    const checkout = checkouts.get(pr.repo.toLowerCase())?.get(pr.info!.headRef)
    if (!checkout) continue
    seen.add(pr.url)
    const prHead = pr.info!.status!.headOid
    const key = `${checkout.head}..${prHead}`
    let c = counts.get(key)
    if (!c) {
      if (checkout.head === prHead) c = { ahead: 0, behind: 0 }
      else if ((await git(checkout.path, 'cat-file', '-e', `${prHead}^{commit}`)).ok) {
        const [a, b] = await Promise.all([
          git(checkout.path, 'rev-list', '--count', `${prHead}..HEAD`),
          git(checkout.path, 'rev-list', '--count', `HEAD..${prHead}`)
        ])
        c = { ahead: a.ok ? Number(a.out.trim()) : null, behind: b.ok ? Number(b.out.trim()) : null }
      } else {
        // The PR moved on and was never fetched here: it differs, but by how much is unknown.
        c = { ahead: null, behind: null }
      }
      counts.set(key, c)
    }
    const next: LocalSync = {
      worktree: checkout.path.startsWith(workspace + sep) ? relative(workspace, checkout.path) : checkout.path,
      ...c
    }
    const prev = byUrl.get(pr.url)
    if (!prev || prev.ahead !== next.ahead || prev.behind !== next.behind || prev.worktree !== next.worktree) {
      byUrl.set(pr.url, next)
      changed = true
    }
  }
  for (const url of [...byUrl.keys()]) {
    if (open.some((p) => p.url === url) && !seen.has(url)) {
      byUrl.delete(url)
      changed = true
    }
  }
  return changed
}
