import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { pinnedTag } from '../src/main/deploys'
import { DeployLine } from '../src/renderer/src/components/links'
import type { DeployState, PrLink } from '../src/shared/types'

// Shaped like a GitOps prod kustomization: base refs pin the tag too, and
// other images can appear in the same file.
const OVERLAY = `resources:
  - github.com/octo-org/gitops//apps/api/base?ref=v1.0.36
images:
  - name: ghcr.io/octo-org/sidecar
    newTag: "v9.9.9"
  - name: ghcr.io/octo-org/acme/api
    newTag: "v1.0.36" # promoted by release
`

describe('pinnedTag', () => {
  it("reads the component's own image tag, not another image's", () => {
    expect(pinnedTag(OVERLAY, /\/acme\/api$/)).toBe('v1.0.36')
    expect(pinnedTag(OVERLAY, /\/sidecar$/)).toBe('v9.9.9')
    expect(pinnedTag(OVERLAY, /\/bot$/)).toBeNull()
    // Comments that merely mention newTag don't count.
    expect(pinnedTag('# bump newTag: v0.0.1 on release\nimages: []\n', /x/)).toBeNull()
  })
})

const merged = (prod: DeployState, stag: DeployState): PrLink => ({
  repo: 'acme/api',
  number: 1,
  url: 'https://github.com/acme/api/pull/1',
  deploy: [
    {
      service: null,
      envs: [
        { id: 'prod', label: 'prod', state: prod },
        { id: 'stag', label: 'staging', state: stag }
      ]
    }
  ],
  info: { title: '', state: 'MERGED', draft: false, headRef: 'b', mergeOid: 'a'.repeat(40), mergedAt: '2026-10-08T00:00:00Z' }
})
const text = (p: PrLink, compact = false) => renderToStaticMarkup(<DeployLine pr={p} compact={compact} />).replace(/<[^>]+>/g, ' ')

describe('DeployLine', () => {
  const live = { state: 'live', tag: 'v1.0.36' } as const
  const pending = { state: 'pending', tag: 'v1.0.34' } as const
  it('says where a merged PR is live', () => {
    expect(text(merged(live, live))).toContain('In prod')
    expect(text(merged(pending, live))).toContain('On staging, not in prod yet')
    expect(text(merged(pending, pending))).toContain('Not deployed yet')
  })
  it('board cards flag only what is not in prod', () => {
    expect(text(merged(live, live), true)).toBe('')
    expect(text(merged(pending, live), true)).toContain('Not in prod')
  })
  it("doesn't guess where prod can't be read", () => {
    const vercel = { state: 'untracked', why: 'deployed by hand' } as const
    expect(text(merged(vercel, live))).toContain('On staging · prod not tracked (deployed by hand)')
    expect(text(merged(vercel, live), true)).toBe('')
    expect(text(merged({ state: 'untracked' }, { state: 'untracked' }))).toBe('')
    expect(text(merged({ state: 'unknown' }, live))).toBe('')
  })
})

describe('DeployLine: environments and services from the project config', () => {
  const env = (id: string, label: string, state: DeployState) => ({ id, label, state })
  const live = (tag: string) => ({ state: 'live', tag }) as const
  const pending = (tag: string) => ({ state: 'pending', tag }) as const
  const pr = (deploy: PrLink['deploy']): PrLink => ({ ...merged(live('x'), live('x')), deploy })

  it('uses the configured labels, and the environment nearest production that has it', () => {
    const three = [env('production', 'production', pending('v3')), env('staging', 'staging', pending('v4')), env('dev', 'dev', live('v5'))]
    expect(text(pr([{ service: null, envs: three }]))).toContain('On dev, not in production yet')
    expect(text(pr([{ service: null, envs: [env('production', 'production', live('v3'))] }]))).toContain('✓ In production')
    expect(text(pr([{ service: null, envs: three }]), true)).toContain('Not in production')
  })

  it('a monorepo PR shows each service it touched; cards only the ones not in production', () => {
    const d = [
      { service: 'api', envs: [env('prod', 'prod', live('api.yml #41'))] },
      { service: 'worker', envs: [env('prod', 'prod', pending('worker.yml #9'))] }
    ]
    expect(text(pr(d))).toContain('api: ✓ In prod')
    expect(text(pr(d))).toContain('worker: Not deployed yet')
    expect(text(pr(d), true)).not.toContain('api')
    expect(text(pr(d), true)).toContain('worker: Not in prod')
    // Touched no tracked service (docs only, say): nothing to say.
    expect(text(pr([]))).toBe('')
  })
})

