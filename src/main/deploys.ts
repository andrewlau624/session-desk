import { execFile } from 'node:child_process'
import type { DeployInfo, DeployService, DeploySource, DeployState, PrLink } from '../shared/types'
import { projectConfig } from './projectConfig'
import { loginPath } from './env'

/**
 * Where merged PRs are live. Each environment's current release comes from
 * the project's .session-desk.json (`deploy`), by one of four methods; a PR
 * is live there when that release contains its merge commit. A GitOps setup
 * (Argo CD or Flux syncing a deploy repo whose overlays pin release tags) is
 * the `pin` method.
 */
// What an environment runs is re-read this often.
const RELEASE_TTL_MS = 5 * 60_000
// Older merges are as good as certainly live; checking them costs API calls for nothing.
const RECENT_MS = 30 * 24 * 3600_000
const NAME_RE = /^[\w.-]+\/[\w.-]+$/
const OID_RE = /^[0-9a-f]{40}$/

/** An environment's release: a ref fixed enough to cache containment against (a tag or a commit), and how to show it. */
interface Release {
  ref: string
  label: string
}
// `${repo}|${env}|${source}` -> release, re-read after RELEASE_TTL_MS.
const releases = new Map<string, { at: number; release: Release | null }>()
// `${repo}|${oid}|${ref}` -> contained. Refs are tags or commits, so this is final.
const contained = new Map<string, boolean>()
const byUrl = new Map<string, DeployInfo>()
// PR url -> the files it changed. A merged PR's files never change.
const filesOf = new Map<string, string[]>()
let running: Promise<boolean> | null = null
// Every PR passed in so far (sessions' and board cards'), newest snapshot of each.
const known = new Map<string, PrLink>()

async function gh(args: string[]): Promise<{ ok: boolean; out: string }> {
  const env = { ...process.env, PATH: await loginPath() }
  return new Promise((resolve) =>
    execFile('gh', args, { env, timeout: 30_000, maxBuffer: 8 << 20 }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? '') }))
  )
}

/** The release tag a kustomization pins for one image (its `images:` entry). */
export function pinnedTag(yaml: string, image: RegExp): string | null {
  const entries = [...yaml.matchAll(/-\s*name:\s*"?([^\s"]+)"?\s*\n\s*newTag:\s*"?([^\s"#]+)"?/g)]
  return entries.find((e) => image.test(e[1]))?.[2] ?? null
}

/** Matches a tag against a glob such as `v*` (only `*` is special). */
export function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(name)
}

/** What the environment runs now, per its configured source; null when it can't be read. */
async function readRelease(repo: string, src: Exclude<DeploySource, { untracked: string }>): Promise<Release | null> {
  if ('pin' in src) {
    const r = await gh(['api', `repos/${src.pin.repo}/contents/${src.pin.path}`, '--jq', '.content'])
    const tag = r.ok ? pinnedTag(Buffer.from(r.out.trim(), 'base64').toString('utf8'), new RegExp(src.pin.image)) : null
    return tag ? { ref: tag, label: tag } : null
  }
  if ('branch' in src) {
    // Branches move: compare against the commit it's at now.
    const r = await gh(['api', `repos/${repo}/commits/${encodeURIComponent(src.branch)}`, '--jq', '.sha'])
    const sha = r.out.trim()
    return r.ok && OID_RE.test(sha) ? { ref: sha, label: `${src.branch} @ ${sha.slice(0, 7)}` } : null
  }
  if ('githubDeployment' in src) {
    // The newest deployment to that environment that succeeded.
    const r = await gh(['api', `repos/${repo}/deployments?environment=${encodeURIComponent(src.githubDeployment)}&per_page=10`, '--jq', '[.[] | {id, sha}]'])
    if (!r.ok) return null
    for (const d of JSON.parse(r.out || '[]') as { id: number; sha: string }[]) {
      const st = await gh(['api', `repos/${repo}/deployments/${d.id}/statuses?per_page=1`, '--jq', '.[0].state'])
      if (st.ok && st.out.trim() === 'success' && OID_RE.test(d.sha)) return { ref: d.sha, label: d.sha.slice(0, 7) }
    }
    return null
  }
  if ('workflowRun' in src) {
    // The newest successful run of the deploy workflow: its commit is what's out.
    const branch = src.workflowRun.branch ? `&branch=${encodeURIComponent(src.workflowRun.branch)}` : ''
    const r = await gh([
      'api',
      `repos/${repo}/actions/workflows/${encodeURIComponent(src.workflowRun.workflow)}/runs?status=success&per_page=1${branch}`,
      '--jq',
      '.workflow_runs[0] | {sha: .head_sha, n: .run_number}'
    ])
    if (!r.ok || !r.out.trim() || r.out.trim() === 'null') return null
    const run = JSON.parse(r.out) as { sha: string; n: number }
    return OID_RE.test(run.sha) ? { ref: run.sha, label: `${src.workflowRun.workflow} #${run.n} (${run.sha.slice(0, 7)})` } : null
  }
  // latestTag: the newest matching tag by its commit's date.
  const [owner, name] = repo.split('/')
  const r = await gh([
    'api',
    'graphql',
    '-f',
    `query=query{repository(owner:"${owner}",name:"${name}"){refs(refPrefix:"refs/tags/",first:50,orderBy:{field:TAG_COMMIT_DATE,direction:DESC}){nodes{name}}}}`,
    '--jq',
    '[.data.repository.refs.nodes[].name]'
  ])
  if (!r.ok) return null
  const tag = (JSON.parse(r.out || '[]') as string[]).find((t) => globMatch(src.latestTag, t))
  return tag ? { ref: tag, label: tag } : null
}

async function releaseOf(repo: string, env: string, src: Exclude<DeploySource, { untracked: string }>): Promise<Release | null> {
  const key = `${repo}|${env}|${JSON.stringify(src)}`
  const hit = releases.get(key)
  if (hit && Date.now() - hit.at < RELEASE_TTL_MS) return hit.release
  const release = await readRelease(repo, src)
  releases.set(key, { at: Date.now(), release })
  return release
}

/** Forgets everything worked out so far (the project or its config changed). */
export function resetDeploys(): void {
  releases.clear()
  byUrl.clear()
}

/**
 * Whether a repo path matches a service's pattern: `**` any depth, `*` and `?`
 * within one segment. A pattern without wildcards is a folder (or file) prefix,
 * so `services/api` covers everything under it.
 */
export function pathMatch(pattern: string, file: string): boolean {
  const p = pattern.replace(/^\.?\//, '').replace(/\/$/, '')
  if (!/[*?]/.test(p)) return file === p || file.startsWith(p + '/')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*' && p[i + 1] === '*') {
      // `**/` matches zero or more whole folders; a trailing `**` matches the rest.
      if (p[i + 2] === '/') {
        re += '(?:.*/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`).test(file)
}

/** The services a PR touched; null when its files can't be read. Services without paths always count. */
async function touched(pr: PrLink, services: DeployService[]): Promise<DeployService[] | null> {
  if (services.every((s) => !s.paths)) return services
  let files = filesOf.get(pr.url)
  if (!files) {
    const r = await gh(['api', `repos/${pr.repo}/pulls/${pr.number}/files`, '--paginate', '--jq', '.[].filename'])
    if (!r.ok) return null
    files = r.out.split('\n').filter(Boolean)
    filesOf.set(pr.url, files)
  }
  return services.filter((s) => !s.paths || files!.some((f) => s.paths!.some((p) => pathMatch(p, f))))
}

async function isContained(repo: string, oid: string, ref: string): Promise<boolean | null> {
  const key = `${repo}|${oid}|${ref}`
  const hit = contained.get(key)
  if (hit !== undefined) return hit
  const r = await gh(['api', `repos/${repo}/compare/${oid}...${encodeURIComponent(ref)}`, '--jq', '.status'])
  if (!r.ok) return null
  // "ahead"/"identical": the release has the commit. "behind"/"diverged": it doesn't.
  const yes = ['ahead', 'identical'].includes(r.out.trim())
  contained.set(key, yes)
  return yes
}

export function deployOf(url: string): DeployInfo | undefined {
  return byUrl.get(url)
}

/** Works out where recently merged PRs are live. Resolves true when anything changed. */
export function refreshDeploys(prs: PrLink[]): Promise<boolean> {
  for (const p of prs) if (p.info) known.set(p.url, p)
  if (running) return running
  running = compute([...known.values()]).finally(() => (running = null))
  return running
}

async function compute(prs: PrLink[]): Promise<boolean> {
  const merged = [...new Map(prs.map((p) => [p.url, p])).values()].filter(
    (p) =>
      p.info?.state === 'MERGED' &&
      p.info.mergeOid &&
      OID_RE.test(p.info.mergeOid) &&
      NAME_RE.test(p.repo) &&
      Date.now() - Date.parse(p.info.mergedAt ?? '') < RECENT_MS
  )
  if (!merged.length) return false
  const { deploy, environments } = projectConfig()
  // Keys are owner/name; GitHub is case-insensitive about them.
  const tracked = new Map(Object.entries(deploy).map(([repo, d]) => [repo.toLowerCase(), d.services]))
  let changed = false
  for (const pr of merged) {
    const repo = pr.repo.toLowerCase()
    const state = async (src: DeploySource | undefined, env: string): Promise<DeployState> => {
      if (!src) return { state: 'untracked' }
      if ('untracked' in src) return { state: 'untracked', why: src.untracked }
      const release = await releaseOf(repo, env, src)
      if (!release) return { state: 'unknown' }
      const yes = await isContained(pr.repo, pr.info!.mergeOid!, release.ref)
      return yes === null ? { state: 'unknown', tag: release.label } : { state: yes ? 'live' : 'pending', tag: release.label }
    }
    const services = tracked.get(repo)
    const hit = services ? await touched(pr, services) : []
    // Files unreadable: try again next round rather than show a guess.
    if (hit === null) continue
    const next: DeployInfo = []
    for (const svc of hit) {
      const envs = []
      for (const e of environments) envs.push({ id: e.id, label: e.label, state: await state(svc.envs[e.id], e.id) })
      next.push({ service: svc.name, envs })
    }
    if (JSON.stringify(byUrl.get(pr.url)) !== JSON.stringify(next)) {
      byUrl.set(pr.url, next)
      changed = true
    }
  }
  return changed
}
