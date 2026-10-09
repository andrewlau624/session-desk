import type { RemoteLeftover } from '../shared/types'
import { git, mapLimit, reposIn, repoName, run } from './worktrees'

const SLUG_RE = /^[\w.-]+\/[\w.-]+$/
const REF_RE = /^[\w.@/+-]{1,250}$/
// Your merged PRs per repo, newest first; enough for years of work.
const MAX_PRS = 1000

interface MergedPr {
  number: number
  url: string
  mergedAt: string
  headRefName: string
  headRefOid: string
  isCrossRepository: boolean
  headRef: {
    name: string
    target: { oid: string }
    branchProtectionRule: { id: string } | null
    /** Open PRs from this branch: a branch reused for new work after the merge. */
    associatedPullRequests: { nodes: { number: number }[] }
  } | null
}

async function graphql<T>(query: string): Promise<T | null> {
  const r = await run('gh', ['api', 'graphql', '-f', `query=${query}`])
  if (!r.ok) return null
  try {
    return (JSON.parse(r.out) as { data?: T }).data ?? null
  } catch {
    return null
  }
}

/** Your merged PRs in the repo whose branch is still on GitHub (newest PR per branch). */
async function leftoverPrs(slug: string): Promise<MergedPr[]> {
  const byBranch = new Map<string, MergedPr>()
  let after: string | null = null
  for (let seen = 0; seen < MAX_PRS; seen += 100) {
    const d: any = await graphql(
      `query{search(query:${JSON.stringify(`repo:${slug} is:pr is:merged author:@me`)},type:ISSUE,first:100${after ? `,after:${JSON.stringify(after)}` : ''}){pageInfo{hasNextPage endCursor} nodes{... on PullRequest{number url mergedAt headRefName headRefOid isCrossRepository headRef{name target{oid} branchProtectionRule{id} associatedPullRequests(states:OPEN,first:3){nodes{number}}}}}}}`
    )
    if (!d) break
    for (const pr of d.search.nodes as MergedPr[]) {
      // A branch reused for several PRs: the newest one decides.
      const prev = byBranch.get(pr.headRefName)
      if (!prev || pr.mergedAt > prev.mergedAt) byBranch.set(pr.headRefName, pr)
    }
    if (!d.search.pageInfo.hasNextPage) break
    after = d.search.pageInfo.endCursor
  }
  return [...byBranch.values()].filter((p) => p.headRef && !p.isCrossRepository)
}

/** Open PRs that use each branch as their base (deleting a base closes them), and the default branch. */
async function baseUsage(slug: string, branches: string[]): Promise<{ openBase: Map<string, number[]>; defaultBranch: string | null }> {
  const [owner, name] = slug.split('/')
  const openBase = new Map<string, number[]>()
  let defaultBranch: string | null = null
  for (let i = 0; i < Math.max(branches.length, 1); i += 30) {
    const chunk = branches.slice(i, i + 30)
    const fields = chunk.map((b, j) => `b${j}:pullRequests(baseRefName:${JSON.stringify(b)},states:OPEN,first:5){nodes{number}}`).join(' ')
    const d: any = await graphql(`query{r:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){defaultBranchRef{name} ${fields}}}`)
    if (!d) throw new Error(`Couldn't check open PRs in ${slug}`)
    defaultBranch = d.r.defaultBranchRef?.name ?? null
    chunk.forEach((b, j) => openBase.set(b, (d.r[`b${j}`]?.nodes ?? []).map((n: { number: number }) => n.number)))
  }
  return { openBase, defaultBranch }
}

/**
 * Whether deleting it loses nothing, most cautious first. Only your own merged
 * PRs are ever listed (closed-unmerged work, and anyone else's branch, never are).
 */
export function decideLeftover(p: {
  sha: string
  prHead: string
  protectedBranch: boolean
  isDefault: boolean
  openBase: number[]
  /** Open PRs from the branch itself (reused after the merge). */
  openHead?: number[]
}): { eligible: boolean; reason: string } {
  if (p.isDefault) return { eligible: false, reason: 'Default branch' }
  if (p.protectedBranch) return { eligible: false, reason: 'Protected branch' }
  if (p.openHead?.length) return { eligible: false, reason: `Has open PR #${p.openHead.join(', #')}` }
  if (p.sha !== p.prHead) return { eligible: false, reason: 'Has commits pushed after the merge' }
  if (p.openBase.length) return { eligible: false, reason: `Base of open PR #${p.openBase.join(', #')}` }
  return { eligible: true, reason: 'PR merged; nothing pushed since' }
}

// Deletion acts only on entries from the last listing.
let listed = new Map<string, RemoteLeftover>()
const key = (slug: string, branch: string) => `${slug.toLowerCase()}\0${branch}`

export async function listRemoteLeftovers(workspace: string): Promise<RemoteLeftover[]> {
  const repos = await reposIn(workspace)
  const perRepo = await mapLimit(repos, 3, async (repo) => {
    const [remote, refs] = await Promise.all([git(repo, 'remote', 'get-url', 'origin'), git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')])
    const slug = /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?$/.exec(remote.out.trim())?.[1]
    if (!slug || !SLUG_RE.test(slug)) return []
    const prs = await leftoverPrs(slug)
    if (!prs.length) return []
    const { openBase, defaultBranch } = await baseUsage(
      slug,
      prs.map((p) => p.headRefName)
    )
    const local = new Set(refs.out.split('\n').filter(Boolean))
    return prs.map((p): RemoteLeftover => {
      const sha = p.headRef!.target.oid
      return {
        repo: repoName(workspace, repo),
        slug,
        branch: p.headRefName,
        sha,
        pr: { number: p.number, url: p.url, mergedAt: p.mergedAt },
        local: local.has(p.headRefName),
        ...decideLeftover({
          sha,
          prHead: p.headRefOid,
          protectedBranch: !!p.headRef!.branchProtectionRule,
          isDefault: p.headRefName === defaultBranch,
          openBase: openBase.get(p.headRefName) ?? [],
          openHead: p.headRef!.associatedPullRequests.nodes.map((n) => n.number)
        })
      }
    })
  })
  const all = perRepo.flat()
  listed = new Map(all.map((l) => [key(l.slug, l.branch), l]))
  return all
}

/**
 * Deletes a listed, eligible branch on GitHub, re-checking first: it still
 * points at the PR's final commit, and no open PR uses it as its base. Resolves
 * with that commit (the PR's Restore branch button brings it back).
 */
export async function deleteRemoteBranch(slug: string, branch: string): Promise<string> {
  const l = listed.get(key(slug, branch))
  if (!l) throw new Error('Refresh the list first')
  if (!l.eligible) throw new Error(l.reason)
  if (!SLUG_RE.test(slug) || !REF_RE.test(branch)) throw new Error('Not a branch name')
  const [owner, name] = slug.split('/')
  const d: any = await graphql(
    `query{r:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){ref(qualifiedName:${JSON.stringify(`refs/heads/${branch}`)}){target{oid} branchProtectionRule{id} associatedPullRequests(states:OPEN,first:1){totalCount}} pullRequests(baseRefName:${JSON.stringify(branch)},states:OPEN,first:1){totalCount}}}`
  )
  if (!d) throw new Error("Couldn't reach GitHub to re-check it")
  if (!d.r.ref) {
    listed.delete(key(slug, branch))
    return l.sha // Already gone.
  }
  if (d.r.ref.target.oid !== l.sha) throw new Error('It has new commits on GitHub since the list was made')
  if (d.r.ref.branchProtectionRule) throw new Error('Protected branch')
  if (d.r.ref.associatedPullRequests?.totalCount > 0) throw new Error('It now has an open PR')
  if (d.r.pullRequests.totalCount > 0) throw new Error('An open PR now uses it as its base')
  const path = branch.split('/').map(encodeURIComponent).join('/')
  const r = await run('gh', ['api', '-X', 'DELETE', `repos/${slug}/git/refs/heads/${path}`])
  if (!r.ok) throw new Error((r.err.trim() || r.out.trim() || 'GitHub refused').split('\n')[0])
  listed.delete(key(slug, branch))
  return l.sha
}
