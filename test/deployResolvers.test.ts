import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeployState, PrLink } from '../src/shared/types'
import { tmp } from './helpers'

// gh, faked: each call's arguments -> its stdout (or a failure).
const answers: [RegExp, string | null][] = []
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out: string) => void) => {
    const line = args.join(' ')
    const hit = answers.find(([re]) => re.test(line))
    if (!hit || hit[1] === null) cb(new Error(`no fake for: ${line}`), '')
    else cb(null, hit[1])
  }
}))
vi.mock('../src/main/env', () => ({ loginPath: async () => '/usr/bin:/bin' }))

const { refreshDeploys, deployOf, resetDeploys, globMatch, pathMatch } = await import('../src/main/deploys')
const { loadProjectConfig, CONFIG_NAME } = await import('../src/main/projectConfig')

const OID = 'a'.repeat(40)
const merged = (repo: string, n = 1): PrLink => ({
  repo,
  number: n,
  url: `https://github.com/${repo}/pull/${n}`,
  info: { title: '', state: 'MERGED', draft: false, headRef: 'b', mergeOid: OID, mergedAt: new Date().toISOString() }
})
const overlay = (tag: string) => Buffer.from(`images:\n  - name: ghcr.io/octo-org/acme/api\n    newTag: "${tag}"\n`).toString('base64')
const useConfig = async (config: object | string) => {
  const dir = tmp()
  writeFileSync(join(dir, CONFIG_NAME), typeof config === 'string' ? config : JSON.stringify(config))
  await loadProjectConfig(dir)
  resetDeploys()
}

beforeEach(() => {
  answers.length = 0
})

/** A repo without services, under the default environments (prod, staging). */
const simple = (prod: DeployState, stag: DeployState) => [
  { service: null, envs: [{ id: 'prod', label: 'prod', state: prod }, { id: 'stag', label: 'staging', state: stag }] }
]

describe('deploy tracking from .session-desk.json', () => {
  it('pinned tags in a GitOps repo, and an environment marked untracked with its reason', async () => {
    // A GitOps repo with one folder per environment and app, each pinning that app's release tag.
    const pin = (component: string, env: string) => ({
      pin: { repo: 'octo-org/gitops', path: `clusters/${env}/${component}/kustomization.yaml`, image: `/acme/${component}$` }
    })
    await useConfig({
      deploy: {
        'octo-org/backend': { prod: pin('server', 'prod'), stag: pin('server', 'stag') },
        'octo-org/docs': { prod: { untracked: 'deployed by hand' }, stag: pin('site', 'stag') }
      }
    })
    const yaml = (component: string, tag: string) =>
      Buffer.from(`images:\n  - name: ghcr.io/octo-org/acme/sidecar\n    newTag: "v0"\n  - name: ghcr.io/octo-org/acme/${component}\n    newTag: "${tag}"\n`).toString('base64')
    answers.push(
      [/repos\/octo-org\/gitops\/contents\/clusters\/prod\/server/, yaml('server', 'v1.0.36')],
      [/repos\/octo-org\/gitops\/contents\/clusters\/stag\/server/, yaml('server', 'v1.0.37')],
      [/repos\/octo-org\/gitops\/contents\/clusters\/stag\/site/, yaml('site', 'v2.0.0')],
      [/compare\/a{40}\.\.\.v1\.0\.36/, 'behind'],
      [/compare\/a{40}\.\.\.v1\.0\.37/, 'ahead'],
      [/compare\/a{40}\.\.\.v2\.0\.0/, 'identical']
    )
    await refreshDeploys([merged('octo-org/backend'), merged('Octo-Org/Docs', 2), merged('acme/other', 3)])
    expect(deployOf('https://github.com/octo-org/backend/pull/1')).toEqual(simple({ state: 'pending', tag: 'v1.0.36' }, { state: 'live', tag: 'v1.0.37' }))
    // Repo names match case-insensitively, as on GitHub.
    expect(deployOf('https://github.com/Octo-Org/Docs/pull/2')).toEqual(simple({ state: 'untracked', why: 'deployed by hand' }, { state: 'live', tag: 'v2.0.0' }))
    // A repo the config doesn't list: nothing tracked.
    expect(deployOf('https://github.com/acme/other/pull/3')).toEqual([])
  })

  it('branch, latest tag and GitHub deployments, compared against a fixed commit or tag', async () => {
    const SHA = 'b'.repeat(40)
    const DEPLOYED = 'c'.repeat(40)
    await useConfig({
      environments: [{ id: 'production', label: 'production' }, { id: 'preview', label: 'preview' }],
      deploy: {
        'acme/web': { production: { branch: 'production' }, preview: { githubDeployment: 'Preview' } },
        'acme/cli': { production: { latestTag: 'v*' } }
      }
    })
    answers.push(
      [/repos\/acme\/web\/commits\/production/, SHA],
      [/repos\/acme\/web\/deployments\?environment=Preview/, JSON.stringify([{ id: 9, sha: 'd'.repeat(40) }, { id: 8, sha: DEPLOYED }])],
      [/deployments\/9\/statuses/, 'failure'],
      [/deployments\/8\/statuses/, 'success'],
      [/refs\(refPrefix:"refs\/tags\/"/, JSON.stringify(['nightly-5', 'v3.1.0', 'v3.0.9'])],
      [new RegExp(`compare/a{40}\\.\\.\\.${SHA}`), 'ahead'],
      [new RegExp(`compare/a{40}\\.\\.\\.${DEPLOYED}`), 'behind'],
      [/compare\/a{40}\.\.\.v3\.1\.0/, 'identical']
    )
    await refreshDeploys([merged('acme/web'), merged('acme/cli', 2)])
    const envs = (production: DeployState, preview: DeployState) => [
      { service: null, envs: [{ id: 'production', label: 'production', state: production }, { id: 'preview', label: 'preview', state: preview }] }
    ]
    expect(deployOf('https://github.com/acme/web/pull/1')).toEqual(
      // The newest deployment failed: the last successful one is what runs.
      envs({ state: 'live', tag: `production @ ${SHA.slice(0, 7)}` }, { state: 'pending', tag: DEPLOYED.slice(0, 7) })
    )
    expect(deployOf('https://github.com/acme/cli/pull/2')).toEqual(envs({ state: 'live', tag: 'v3.1.0' }, { state: 'untracked' }))
  })

  it("an environment that can't be read is unknown, not guessed", async () => {
    await useConfig({ deploy: { 'acme/web': { prod: { branch: 'production' } } } })
    answers.push([/commits\/production/, null])
    await refreshDeploys([merged('acme/web')])
    expect(deployOf('https://github.com/acme/web/pull/1')?.[0].envs[0].state).toEqual({ state: 'unknown' })
  })

  it('a monorepo: only the services a PR touched, each by its own workflow run', async () => {
    await useConfig({
      deploy: {
        'acme/mono': {
          services: {
            api: { paths: ['services/api', 'packages/shared/**'], prod: { workflowRun: { workflow: 'deploy-api.yml', branch: 'main' } } },
            worker: { paths: ['services/worker/**'], prod: { workflowRun: { workflow: 'deploy-worker.yml', branch: 'main' } } },
            web: { paths: ['apps/web/**'], prod: { githubDeployment: 'web-production' } }
          }
        }
      }
    })
    const API = 'd'.repeat(40)
    const WORKER = 'e'.repeat(40)
    answers.push(
      [/pulls\/1\/files/, 'services/api/main.go\npackages/shared/log/log.go\nservices/worker/queue.go\nREADME.md\n'],
      [/pulls\/2\/files/, 'docs/runbook.md\n'],
      [/pulls\/3\/files/, null],
      [/actions\/workflows\/deploy-api\.yml\/runs\?status=success&per_page=1&branch=main/, JSON.stringify({ sha: API, n: 41 })],
      [/actions\/workflows\/deploy-worker\.yml\/runs/, JSON.stringify({ sha: WORKER, n: 9 })],
      [new RegExp(`compare/a{40}\\.\\.\\.${API}`), 'ahead'],
      [new RegExp(`compare/a{40}\\.\\.\\.${WORKER}`), 'behind']
    )
    await refreshDeploys([merged('acme/mono'), merged('acme/mono', 2), merged('acme/mono', 3)])
    const prod = (state: DeployState) => [{ id: 'prod', label: 'prod', state }, { id: 'stag', label: 'staging', state: { state: 'untracked' } }]
    expect(deployOf('https://github.com/acme/mono/pull/1')).toEqual([
      { service: 'api', envs: prod({ state: 'live', tag: `deploy-api.yml #41 (${API.slice(0, 7)})` }) },
      { service: 'worker', envs: prod({ state: 'pending', tag: `deploy-worker.yml #9 (${WORKER.slice(0, 7)})` }) }
    ])
    // Docs only: no service touched.
    expect(deployOf('https://github.com/acme/mono/pull/2')).toEqual([])
    // Files unreadable: no guess; asked again next round.
    expect(deployOf('https://github.com/acme/mono/pull/3')).toBeUndefined()
  })

  it('pathMatch: folders, ** and *', () => {
    expect(pathMatch('services/api', 'services/api/main.go')).toBe(true)
    expect(pathMatch('services/api', 'services/api-gateway/main.go')).toBe(false)
    expect(pathMatch('services/api/', 'services/api/x/y.go')).toBe(true)
    expect(pathMatch('packages/shared/**', 'packages/shared/log/log.go')).toBe(true)
    expect(pathMatch('**/*.proto', 'proto/v1/api.proto')).toBe(true)
    expect(pathMatch('**/*.proto', 'api.proto')).toBe(true)
    expect(pathMatch('apps/*/package.json', 'apps/web/package.json')).toBe(true)
    expect(pathMatch('apps/*/package.json', 'apps/web/sub/package.json')).toBe(false)
  })

  it('globMatch: only * is special', () => {
    expect(globMatch('v*', 'v1.2.3')).toBe(true)
    expect(globMatch('v*', 'nightly-5')).toBe(false)
    expect(globMatch('release-*.*', 'release-1.2')).toBe(true)
    expect(globMatch('v1.0', 'v1x0')).toBe(false)
  })
})
