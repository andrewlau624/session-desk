import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { DeployService, DeploySource, ProjectConfig, ProjectConfigStatus } from '../shared/types'

export const CONFIG_NAME = '.session-desk.json'

/** Used for anything the file leaves out, or when there is no file. */
export const DEFAULTS: ProjectConfig = {
  worktrees: '{repo}-wt/{ticket}',
  contextFolder: 'evidence',
  environments: [
    { id: 'prod', label: 'prod' },
    { id: 'stag', label: 'staging' }
  ],
  deploy: {}
}

const KEYS = new Set(['worktrees', 'contextFolder', 'environments', 'deploy'])
const ID_RE = /^[a-z][a-z0-9-]{0,30}$/
const SLUG_RE = /^[\w.-]+\/[\w.-]+$/
const SERVICE_RE = /^[\w.-]{1,40}$/
const SOURCES = 'pin, branch, githubDeployment, latestTag, workflowRun, untracked'
// A relative path inside the project: no `..`, not absolute.
const REL_RE = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w.@{}/ -]+$/

class ConfigError extends Error {}
const fail = (where: string, what: string): never => {
  throw new ConfigError(`${where}: ${what}`)
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, where: string): string => (typeof v === 'string' && v.trim() ? v : fail(where, 'expected a non-empty string'))

function source(v: unknown, where: string): DeploySource {
  if (!isObj(v)) return fail(where, `expected an object with one of ${SOURCES}`)
  const kinds = Object.keys(v)
  if (kinds.length !== 1) return fail(where, `expected exactly one of ${SOURCES} (got ${kinds.join(', ') || 'none'})`)
  const [kind] = kinds
  switch (kind) {
    case 'pin': {
      const p = v.pin
      if (!isObj(p)) return fail(`${where}.pin`, 'expected { repo, path, image }')
      const repo = str(p.repo, `${where}.pin.repo`)
      if (!SLUG_RE.test(repo)) fail(`${where}.pin.repo`, `expected owner/name, got "${repo}"`)
      const path = str(p.path, `${where}.pin.path`)
      const image = str(p.image, `${where}.pin.image`)
      try {
        new RegExp(image)
      } catch {
        fail(`${where}.pin.image`, `not a valid regular expression: ${image}`)
      }
      return { pin: { repo, path, image } }
    }
    case 'branch':
      return { branch: str(v.branch, `${where}.branch`) }
    case 'githubDeployment':
      return { githubDeployment: str(v.githubDeployment, `${where}.githubDeployment`) }
    case 'latestTag':
      return { latestTag: str(v.latestTag, `${where}.latestTag`) }
    case 'untracked':
      return { untracked: str(v.untracked, `${where}.untracked`) }
    case 'workflowRun': {
      const w = v.workflowRun
      if (!isObj(w)) return fail(`${where}.workflowRun`, 'expected { workflow, branch? }')
      const workflow = str(w.workflow, `${where}.workflowRun.workflow`)
      if (!/^[\w.-]+$/.test(workflow)) fail(`${where}.workflowRun.workflow`, `expected a workflow file name like deploy.yml, got "${workflow}"`)
      return 'branch' in w ? { workflowRun: { workflow, branch: str(w.branch, `${where}.workflowRun.branch`) } } : { workflowRun: { workflow } }
    }
    default:
      return fail(where, `unknown source "${kind}" (expected ${SOURCES})`)
  }
}

/** Parses and checks a config file's text. Errors name the setting at fault. */
export function parseConfig(text: string): { config: ProjectConfig } | { error: string } {
  try {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (e) {
      return { error: `not valid JSON: ${(e as Error).message}` }
    }
    if (!isObj(raw)) return { error: 'expected a JSON object' }
    const unknown = Object.keys(raw).filter((k) => !KEYS.has(k))
    if (unknown.length) fail(unknown[0], `unknown setting (expected ${[...KEYS].join(', ')})`)

    const config: ProjectConfig = structuredClone(DEFAULTS)
    if ('worktrees' in raw) {
      const w = str(raw.worktrees, 'worktrees')
      if (!w.includes('{ticket}')) fail('worktrees', 'must contain {ticket}')
      if (!REL_RE.test(w)) fail('worktrees', 'must be a path inside the project folder')
      config.worktrees = w
    }
    if ('contextFolder' in raw) {
      if (raw.contextFolder === null) config.contextFolder = null
      else {
        const c = str(raw.contextFolder, 'contextFolder')
        if (!REL_RE.test(c)) fail('contextFolder', 'must be a folder inside the project folder, or null')
        config.contextFolder = c
      }
    }
    if ('environments' in raw) {
      const envs = raw.environments
      if (!Array.isArray(envs) || envs.length === 0) fail('environments', 'expected a non-empty list of { id, label }')
      config.environments = (envs as unknown[]).map((e, i) => {
        if (!isObj(e)) return fail(`environments[${i}]`, 'expected { id, label }')
        const id = str(e.id, `environments[${i}].id`)
        if (!ID_RE.test(id)) fail(`environments[${i}].id`, `use lower-case letters, digits and dashes, got "${id}"`)
        return { id, label: str(e.label, `environments[${i}].label`) }
      })
      const ids = config.environments.map((e) => e.id)
      const dup = ids.find((id, i) => ids.indexOf(id) !== i)
      if (dup) fail('environments', `"${dup}" appears twice`)
    }
    if ('deploy' in raw) {
      if (!isObj(raw.deploy)) fail('deploy', 'expected { "owner/repo": { "<environment id>": source } or { "services": … } }')
      const envIds = new Set(config.environments.map((e) => e.id))
      const envMap = (v: Record<string, unknown>, where: string, skip: string[] = []) => {
        const envs: Record<string, DeploySource> = {}
        for (const [env, src] of Object.entries(v)) {
          if (skip.includes(env)) continue
          if (!envIds.has(env)) fail(`${where}.${env}`, `no such environment (environments are ${[...envIds].join(', ')})`)
          envs[env] = source(src, `${where}.${env}`)
        }
        return envs
      }
      for (const [repo, value] of Object.entries(raw.deploy as Record<string, unknown>)) {
        const where = `deploy["${repo}"]`
        if (!SLUG_RE.test(repo)) fail(where, 'expected an owner/name key')
        if (!isObj(value)) fail(where, 'expected { "<environment id>": source } or { "services": … }')
        const v = value as Record<string, unknown>
        if (!('services' in v)) {
          config.deploy[repo] = { services: [{ name: null, paths: null, envs: envMap(v, where) }] }
          continue
        }
        // A monorepo: each service deploys on its own, from its own paths.
        if (Object.keys(v).length !== 1) fail(where, 'with "services", environments go inside each service')
        if (!isObj(v.services) || !Object.keys(v.services).length) fail(`${where}.services`, 'expected { "<service>": { "paths": [...], "<environment id>": source } }')
        const services: DeployService[] = []
        for (const [name, svc] of Object.entries(v.services as Record<string, unknown>)) {
          const sw = `${where}.services.${name}`
          if (!SERVICE_RE.test(name)) fail(sw, 'use letters, digits, dots, dashes and underscores')
          if (!isObj(svc)) fail(sw, 'expected { "paths": [...], "<environment id>": source }')
          const s = svc as Record<string, unknown>
          if (!Array.isArray(s.paths) || !s.paths.length) fail(`${sw}.paths`, 'expected a non-empty list of paths or globs')
          const paths = (s.paths as unknown[]).map((p, i) => {
            const path = str(p, `${sw}.paths[${i}]`)
            if (!REL_RE.test(path.replace(/[*?]/g, 'x'))) fail(`${sw}.paths[${i}]`, 'must be a path inside the repo')
            return path
          })
          services.push({ name, paths, envs: envMap(s, sw, ['paths']) })
        }
        config.deploy[repo] = { services }
      }
    }
    return { config }
  } catch (e) {
    if (e instanceof ConfigError) return { error: e.message }
    throw e
  }
}

/** One line per setting, for Settings. */
export function summarize(c: ProjectConfig): string[] {
  const repos = Object.entries(c.deploy).map(([repo, { services }]) => {
    const name = repo.split('/').pop()
    const named = services.flatMap((s) => (s.name ? [s.name] : []))
    return named.length ? `${name} (${named.join(', ')})` : name
  })
  return [
    `Ticket worktrees: ${c.worktrees}`,
    c.contextFolder ? `Ticket context folder: ${c.contextFolder}/` : 'No ticket context folder',
    `Environments: ${c.environments.map((e) => e.label).join(', ')}`,
    repos.length ? `Deploy tracking: ${repos.join(', ')}` : 'No deploy tracking'
  ]
}

let current: { workspace: string | null; config: ProjectConfig; status: ProjectConfigStatus | null } = {
  workspace: null,
  config: DEFAULTS,
  status: null
}

/** The project's settings, with defaults filled in (defaults without a file or with a rejected one). */
export function projectConfig(): ProjectConfig {
  return current.config
}

export function projectConfigStatus(): ProjectConfigStatus | null {
  return current.status
}

/** Reads the project folder's config. Resolves true if the result changed. */
export async function loadProjectConfig(workspace: string | null): Promise<boolean> {
  const before = JSON.stringify(current)
  if (!workspace) {
    current = { workspace: null, config: DEFAULTS, status: null }
    return before !== JSON.stringify(current)
  }
  const file = join(workspace, CONFIG_NAME)
  const text = await fs.readFile(file, 'utf8').catch(() => null)
  if (text === null) {
    current = { workspace, config: DEFAULTS, status: { file, state: 'none', summary: summarize(DEFAULTS) } }
  } else {
    const r = parseConfig(text)
    current =
      'config' in r
        ? { workspace, config: r.config, status: { file, state: 'loaded', summary: summarize(r.config) } }
        : { workspace, config: DEFAULTS, status: { file, state: 'invalid', error: r.error, summary: summarize(DEFAULTS) } }
  }
  return before !== JSON.stringify(current)
}

/** Reloads when the file changes; returns a stop function. */
export function watchProjectConfig(workspace: string | null, onChange: () => void): () => void {
  if (!workspace) return () => {}
  let timer: NodeJS.Timeout | undefined
  let w: FSWatcher | null = null
  try {
    w = watch(workspace, (_event, name) => {
      if (name && name.toString() !== CONFIG_NAME) return
      clearTimeout(timer)
      // Editors save in several steps; read once they're done.
      timer = setTimeout(() => void loadProjectConfig(workspace).then((changed) => changed && onChange()), 200)
    })
  } catch {
    // The folder vanished: nothing to watch.
  }
  return () => {
    clearTimeout(timer)
    w?.close()
  }
}

/** A starting file: the defaults, written out so they're easy to edit. */
export function starterConfig(): string {
  const { deploy: _deploy, ...rest } = DEFAULTS
  return JSON.stringify({ ...rest, deploy: {} }, null, 2) + '\n'
}
