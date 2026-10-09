import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmp } from './helpers'

// git and gh, faked: every command line is recorded, answers come from `reply`.
const calls: string[] = []
let reply: (line: string) => string | null = () => null
vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, out: string, errOut: string) => void) => {
    const line = `${cmd} ${args.join(' ')}`
    calls.push(line)
    const out = reply(line)
    if (out === null) cb(new Error('no fake'), '', 'no fake')
    else cb(null, out, '')
  }
}))
vi.mock('../src/main/env', () => ({ loginPath: async () => '/usr/bin:/bin' }))

const { decideLeftover, deleteRemoteBranch, listRemoteLeftovers } = await import('../src/main/remoteBranches')

const SHA = (c: string) => c.repeat(40)
const pr = (number: number, branch: string, head: string, tip: string | null, extra: object = {}) => ({
  number,
  url: `https://github.com/acme/api/pull/${number}`,
  mergedAt: `2026-09-${String(number).padStart(2, '0')}T00:00:00Z`,
  headRefName: branch,
  headRefOid: head,
  isCrossRepository: false,
  headRef: tip ? { name: branch, target: { oid: tip }, branchProtectionRule: null, associatedPullRequests: { nodes: [] } } : null,
  ...extra
})

describe('decideLeftover', () => {
  const ok = { sha: SHA('a'), prHead: SHA('a'), protectedBranch: false, isDefault: false, openBase: [] as number[] }
  it('goes only when it still points at the PR’s final commit and nothing builds on it', () => {
    expect(decideLeftover(ok)).toEqual({ eligible: true, reason: 'PR merged; nothing pushed since' })
    expect(decideLeftover({ ...ok, sha: SHA('b') })).toEqual({ eligible: false, reason: 'Has commits pushed after the merge' })
    expect(decideLeftover({ ...ok, openBase: [9, 12] })).toEqual({ eligible: false, reason: 'Base of open PR #9, #12' })
    expect(decideLeftover({ ...ok, protectedBranch: true }).eligible).toBe(false)
    // Reused for new work after the merge: deleting it would close that PR.
    expect(decideLeftover({ ...ok, openHead: [21] })).toEqual({ eligible: false, reason: 'Has open PR #21' })
    expect(decideLeftover({ ...ok, isDefault: true }).eligible).toBe(false)
  })
})

describe('listing and deleting GitHub leftovers (gh faked)', () => {
  let ws: string
  beforeEach(() => {
    calls.length = 0
    ws = tmp()
    mkdirSync(join(ws, 'api', '.git'), { recursive: true })
    const search = {
      data: {
        search: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            pr(1, 'me/eng-1', SHA('a'), SHA('a')),
            pr(2, 'me/eng-2', SHA('b'), SHA('c')),
            pr(3, 'me/eng-3', SHA('d'), SHA('d')),
            pr(4, 'me/fork', SHA('e'), SHA('e'), { isCrossRepository: true }),
            pr(5, 'me/gone', SHA('f'), null),
            // Reused branch: the newer PR (#7) decides.
            pr(6, 'me/reused', SHA('1'), SHA('2')),
            pr(7, 'me/reused', SHA('2'), SHA('2'))
          ]
        }
      }
    }
    reply = (line) => {
      if (line.includes('remote get-url origin')) return 'https://github.com/acme/api.git\n'
      if (line.includes('for-each-ref')) return 'main\nme/eng-1\n'
      if (line.includes('search(query:')) return JSON.stringify(search)
      if (line.includes('baseRefName:') && line.includes('defaultBranchRef')) {
        // b0.. in the order listed; me/eng-3 is the base of open PR #9.
        const names = [...line.matchAll(/b(\d+):pullRequests\(baseRefName:"([^"]+)"/g)].map((m) => [m[1], m[2]])
        return JSON.stringify({ data: { r: { defaultBranchRef: { name: 'main' }, ...Object.fromEntries(names.map(([j, n]) => [`b${j}`, { nodes: n === 'me/eng-3' ? [{ number: 9 }] : [] }])) } } })
      }
      if (line.includes('ref(qualifiedName:')) {
        const tip = line.includes('me/eng-1') ? SHA('a') : line.includes('me/reused') ? SHA('9') : SHA('0')
        return JSON.stringify({ data: { r: { ref: { target: { oid: tip }, branchProtectionRule: null, associatedPullRequests: { totalCount: 0 } }, pullRequests: { totalCount: 0 } } } })
      }
      if (line.startsWith('gh api -X DELETE')) return ''
      return null
    }
  })

  it('lists your merged PRs’ branches still on GitHub, with why each can or can’t go', async () => {
    const list = await listRemoteLeftovers(ws)
    const by = Object.fromEntries(list.map((l) => [l.branch, [l.eligible, l.reason, l.pr.number, l.local]]))
    expect(by).toEqual({
      'me/eng-1': [true, 'PR merged; nothing pushed since', 1, true],
      'me/eng-2': [false, 'Has commits pushed after the merge', 2, false],
      'me/eng-3': [false, 'Base of open PR #9', 3, false],
      'me/reused': [true, 'PR merged; nothing pushed since', 7, false]
    })
    // Only your merged PRs are ever searched.
    expect(calls.find((c) => c.includes('search(query:'))).toContain('repo:acme/api is:pr is:merged author:@me')
  })

  it('deletes only listed, eligible branches, re-checked on GitHub first', async () => {
    await listRemoteLeftovers(ws)
    expect(await deleteRemoteBranch('acme/api', 'me/eng-1')).toBe(SHA('a'))
    expect(calls).toContain('gh api -X DELETE repos/acme/api/git/refs/heads/me/eng-1')
    await expect(deleteRemoteBranch('acme/api', 'me/eng-2')).rejects.toThrow('Has commits pushed after the merge')
    await expect(deleteRemoteBranch('acme/api', 'me/eng-3')).rejects.toThrow('Base of open PR #9')
    await expect(deleteRemoteBranch('acme/api', 'someone/else')).rejects.toThrow('Refresh the list first')
    // Moved on GitHub since the listing: refused, nothing deleted.
    await expect(deleteRemoteBranch('acme/api', 'me/reused')).rejects.toThrow('new commits on GitHub since the list was made')
    expect(calls.filter((c) => c.startsWith('gh api -X DELETE'))).toEqual(['gh api -X DELETE repos/acme/api/git/refs/heads/me/eng-1'])
  })
})
