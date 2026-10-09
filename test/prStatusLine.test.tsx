import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PrStatusLine } from '../src/renderer/src/components/links'
import type { LocalSync, PrLink } from '../src/shared/types'

const pr = (local?: LocalSync, greptile: 'current' | 'none' | 'absent' = 'current'): PrLink => ({
  repo: 'acme/api',
  number: 9202,
  url: 'https://github.com/acme/api/pull/9202',
  local,
  info: {
    title: 't',
    state: 'OPEN',
    draft: false,
    headRef: 'me/eng-8812',
    status: {
      headOid: 'x',
      readyAt: '2026-10-08T00:00:00Z',
      checks: 'passing',
      review: 'approved',
      unresolvedThreads: 1,
      greptile: greptile === 'current' ? { state: 'current', confidence: 5 } : { state: greptile }
    }
  }
})

const text = (p: PrLink, compact = false) => renderToStaticMarkup(<PrStatusLine pr={p} compact={compact} />).replace(/<[^>]+>/g, ' ')

describe('PrStatusLine', () => {
  const wt = 'api-wt/eng-8812'
  it('warns about local commits the PR does not have', () => {
    expect(text(pr({ worktree: wt, ahead: 2, behind: 0 }))).toContain('2 local commits not pushed')
    expect(text(pr({ worktree: wt, ahead: 1, behind: 0 }))).toContain('1 local commit not pushed')
    expect(text(pr({ worktree: wt, ahead: 2, behind: 0 }), true)).toContain('2 unpushed')
  })

  it('says when it cannot compare, and notes newer commits on GitHub quietly', () => {
    expect(text(pr({ worktree: wt, ahead: null, behind: null }))).toContain('Local branch differs from the PR')
    expect(text(pr({ worktree: wt, ahead: 0, behind: 3 }))).toContain('3 newer on GitHub')
    // Behind is not worth a board card's space.
    expect(text(pr({ worktree: wt, ahead: 0, behind: 3 }), true)).not.toContain('newer')
  })

  it('says nothing about sync when in sync or with no checkout', () => {
    for (const p of [pr({ worktree: wt, ahead: 0, behind: 0 }), pr(undefined)]) {
      expect(text(p)).not.toMatch(/unpushed|not pushed|differs|newer/)
    }
  })

  it('board cards show only what needs attention', () => {
    const t = text(pr({ worktree: wt, ahead: 0, behind: 0 }), true)
    expect(t).not.toContain('Checks passing')
    expect(t).not.toContain('Approved')
    expect(t).toContain('1 unresolved')
    expect(text(pr(undefined, 'none'), true)).toContain('No Greptile')
  })

  it('says nothing about Greptile on repos without it', () => {
    for (const compact of [false, true]) {
      const t = text(pr(undefined, 'absent'), compact)
      expect(t).not.toMatch(/Greptile/)
    }
  })
})
