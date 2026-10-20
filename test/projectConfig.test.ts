import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG_NAME, DEFAULTS, loadProjectConfig, parseConfig, projectConfig, projectConfigStatus, starterConfig, summarize } from '../src/main/projectConfig'
import { tmp } from './helpers'

const ok = (v: object) => {
  const r = parseConfig(JSON.stringify(v))
  if ('error' in r) throw new Error(r.error)
  return r.config
}
const err = (v: object | string) => {
  const r = parseConfig(typeof v === 'string' ? v : JSON.stringify(v))
  return 'error' in r ? r.error : null
}

// A typical .session-desk.json: the defaults written out, plus a deploy map.
const sample = {
  worktrees: '{repo}-wt/{ticket}',
  contextFolder: 'evidence',
  environments: [
    { id: 'prod', label: 'prod' },
    { id: 'stag', label: 'staging' }
  ],
  deploy: {
    'octo-org/api': {
      prod: { pin: { repo: 'octo-org/gitops', path: 'clusters/prod/api/kustomization.yaml', image: '/api$' } }
    },
    'octo-org/web': { stag: { pin: { repo: 'octo-org/gitops', path: 'x.yaml', image: '/web$' } } }
  }
}

describe('.session-desk.json', () => {
  it('fills anything left out with the defaults; an empty file is all defaults', () => {
    expect(ok({})).toEqual(DEFAULTS)
    expect(ok({ contextFolder: null }).contextFolder).toBeNull()
    expect(ok({ worktrees: '.worktrees/{ticket}' }).worktrees).toBe('.worktrees/{ticket}')
  })

  it('takes a typical config and every kind of deploy source', () => {
    expect(ok(sample).deploy['octo-org/api']).toEqual({
      services: [{ name: null, paths: null, envs: sample.deploy['octo-org/api'] }]
    })
    const c = ok({
      environments: [{ id: 'production', label: 'production' }],
      deploy: {
        'octo-org/web': { production: { branch: 'production' } },
        'octo-org/api': { production: { githubDeployment: 'production' } },
        'octo-org/cli': { production: { latestTag: 'v*' } }
      }
    })
    expect(Object.keys(c.deploy)).toEqual(['octo-org/web', 'octo-org/api', 'octo-org/cli'])
    expect(summarize(c)).toContain('Deploy tracking: web, api, cli')
  })

  it('names the setting at fault', () => {
    expect(err('{ nope')).toMatch(/^not valid JSON/)
    expect(err({ worktree: 'x' })).toBe('worktree: unknown setting (expected worktrees, contextFolder, environments, deploy)')
    expect(err({ worktrees: '{repo}-wt' })).toBe('worktrees: must contain {ticket}')
    expect(err({ worktrees: '../elsewhere/{ticket}' })).toBe('worktrees: must be a path inside the project folder')
    expect(err({ contextFolder: '/abs' })).toBe('contextFolder: must be a folder inside the project folder, or null')
    expect(err({ environments: [{ id: 'Prod', label: 'p' }] })).toBe('environments[0].id: use lower-case letters, digits and dashes, got "Prod"')
    expect(err({ environments: [{ id: 'a', label: 'a' }, { id: 'a', label: 'b' }] })).toBe('environments: "a" appears twice')
    expect(err({ deploy: { 'octo-org/web': { qa: { branch: 'qa' } } } })).toBe('deploy["octo-org/web"].qa: no such environment (environments are prod, stag)')
    expect(err({ deploy: { 'octo-org/web': { prod: { branch: 'x', latestTag: 'v*' } } } })).toMatch(/^deploy\["octo-org\/web"\]\.prod: expected exactly one of/)
    expect(err({ deploy: { 'octo-org/web': { prod: { pin: { repo: 'nope', path: 'p', image: 'i' } } } } })).toBe('deploy["octo-org/web"].prod.pin.repo: expected owner/name, got "nope"')
    expect(err({ deploy: { 'octo-org/web': { prod: { pin: { repo: 'a/b', path: 'p', image: '(' } } } } })).toBe('deploy["octo-org/web"].prod.pin.image: not a valid regular expression: (')
  })

  it('loads from the project folder: none, loaded, or rejected with defaults in force', async () => {
    const dir = tmp()
    await loadProjectConfig(dir)
    expect(projectConfigStatus()).toMatchObject({ state: 'none', file: join(dir, CONFIG_NAME) })

    writeFileSync(join(dir, CONFIG_NAME), JSON.stringify(sample))
    expect(await loadProjectConfig(dir)).toBe(true)
    expect(projectConfigStatus()?.state).toBe('loaded')
    expect(Object.keys(projectConfig().deploy)).toHaveLength(2)
    expect(await loadProjectConfig(dir)).toBe(false)

    writeFileSync(join(dir, CONFIG_NAME), '{"worktrees": 3}')
    await loadProjectConfig(dir)
    expect(projectConfigStatus()).toMatchObject({ state: 'invalid', error: 'worktrees: expected a non-empty string' })
    expect(projectConfig()).toEqual(DEFAULTS)
  })

  it('the starter file is valid and is just the defaults', () => {
    expect(ok(JSON.parse(starterConfig()))).toEqual(DEFAULTS)
  })
})

describe('.session-desk.json: monorepo services and workflow runs', () => {
  it('takes services with their paths and their own environments', () => {
    const c = ok({
      deploy: {
        'octo-org/mono': {
          services: {
            api: { paths: ['services/api', 'packages/shared/**'], prod: { workflowRun: { workflow: 'deploy-api.yml', branch: 'main' } } },
            worker: { paths: ['services/worker/**'], prod: { githubDeployment: 'worker-production' }, stag: { workflowRun: { workflow: 'deploy-worker.yml' } } }
          }
        }
      }
    })
    expect(c.deploy['octo-org/mono'].services).toEqual([
      { name: 'api', paths: ['services/api', 'packages/shared/**'], envs: { prod: { workflowRun: { workflow: 'deploy-api.yml', branch: 'main' } } } },
      { name: 'worker', paths: ['services/worker/**'], envs: { prod: { githubDeployment: 'worker-production' }, stag: { workflowRun: { workflow: 'deploy-worker.yml' } } } }
    ])
    expect(summarize(c)).toContain('Deploy tracking: mono (api, worker)')
  })

  it('names what is wrong with a service', () => {
    const svc = (v: object) => err({ deploy: { 'octo-org/mono': { services: { api: v } } } })
    expect(svc({ prod: { branch: 'main' } })).toBe('deploy["octo-org/mono"].services.api.paths: expected a non-empty list of paths or globs')
    expect(svc({ paths: ['../x'], prod: { branch: 'main' } })).toBe('deploy["octo-org/mono"].services.api.paths[0]: must be a path inside the repo')
    expect(svc({ paths: ['a'], qa: { branch: 'main' } })).toBe('deploy["octo-org/mono"].services.api.qa: no such environment (environments are prod, stag)')
    expect(svc({ paths: ['a'], prod: { workflowRun: { workflow: 'deploy api.yml' } } })).toBe(
      'deploy["octo-org/mono"].services.api.prod.workflowRun.workflow: expected a workflow file name like deploy.yml, got "deploy api.yml"'
    )
    expect(err({ deploy: { 'octo-org/mono': { services: { api: { paths: ['a'] } }, prod: { branch: 'main' } } } })).toBe(
      'deploy["octo-org/mono"]: with "services", environments go inside each service'
    )
  })
})

