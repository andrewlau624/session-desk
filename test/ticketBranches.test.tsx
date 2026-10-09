import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ticketBranches } from '../src/main/worktrees'
import { BranchLine, branchState } from '../src/renderer/src/components/SessionHeader'
import type { PrLink, TicketBranch } from '../src/shared/types'
import { tmp } from './helpers'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' })

// The ENG-8825 case: a worktree at <repo>-wt/eng-8825 on me/eng-8825, pushed, one commit, no PR yet.
const b = (over: Partial<TicketBranch> = {}): TicketBranch => ({
  repo: 'api',
  branch: 'me/eng-8825',
  label: 'api-wt/eng-8825',
  slug: 'acme/api',
  defaultBranch: 'main',
  pushed: true,
  remoteBranch: null,
  unpushed: 0,
  ahead: 1,
  changes: 0,
  ...over
})
const text = (branch: TicketBranch, pr?: PrLink) => renderToStaticMarkup(<BranchLine branch={branch} pr={pr} />)

describe('the ticket branch line', () => {
  it('says where the branch stands', () => {
    expect(branchState(b())).toBe('pushed, 1 commit ahead of main')
    expect(branchState(b({ pushed: false, unpushed: 2, ahead: 2 }))).toBe('not pushed, 2 commits ahead of main')
    expect(branchState(b({ unpushed: 3, ahead: 4, changes: 1 }))).toBe('3 unpushed commits, 4 commits ahead of main, 1 uncommitted change')
    expect(branchState(b({ pushed: false, ahead: 0 }))).toBe('not pushed, no commits past main yet')
  })

  it('Create PR asks Claude (a button, not a GitHub link) once there are commits', () => {
    const html = renderToStaticMarkup(<BranchLine branch={b()} onOpenPr={() => {}} />)
    expect(html).toContain('no PR yet')
    expect(html).toMatch(/<button[^>]*>Create PR<\/button>/)
    expect(html).not.toContain('/compare/')
    expect(html).toContain('https://github.com/acme/api/tree/me/eng-8825')
    // Unpushed commits are fine: Claude pushes them first.
    expect(renderToStaticMarkup(<BranchLine branch={b({ pushed: false })} onOpenPr={() => {}} />)).toContain('Create PR')
    // Nothing to open it from, or nowhere to ask.
    expect(renderToStaticMarkup(<BranchLine branch={b({ ahead: 0 })} onOpenPr={() => {}} />)).not.toContain('Create PR')
    expect(text(b())).not.toContain('Create PR')
  })

  it('is disabled, saying why, while the session is busy', () => {
    const html = renderToStaticMarkup(<BranchLine branch={b()} onOpenPr={() => {}} blocked="Claude is working in this session" />)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Claude is working in this session"/)
  })

  it('names the PR once there is one', () => {
    const pr: PrLink = { repo: 'acme/api', number: 9230, url: 'u' }
    const html = text(b(), pr)
    expect(html).toContain('PR #9230')
    expect(html).not.toContain('Create PR')
  })
})

describe('ticketBranches (real git)', () => {
  it("finds the ticket's worktree and main-checkout branches, and nothing else", async () => {
    const root = realpathSync(tmp())
    const ws = join(root, 'ws')
    mkdirSync(ws)
    git(root, 'init', '-q', '--bare', 'remote.git')
    git(ws, 'init', '-q', 'api')
    const repo = join(ws, 'api')
    writeFileSync(join(repo, 'README.md'), 'hi\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'init')
    git(repo, 'remote', 'add', 'origin', join(root, 'remote.git'))
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(repo, 'remote', 'set-head', 'origin', 'main')

    // Ours: pushed with one commit, then one more local commit and an edit.
    const wt = join(ws, 'api-wt', 'eng-8825')
    git(repo, 'worktree', 'add', '-q', '-b', 'me/eng-8825', wt, 'origin/main')
    writeFileSync(join(wt, 'a.txt'), 'a\n')
    git(wt, 'add', 'a.txt')
    git(wt, 'commit', '-qm', 'a')
    git(wt, 'push', '-q', '-u', 'origin', 'me/eng-8825')
    writeFileSync(join(wt, 'b.txt'), 'b\n')
    git(wt, 'add', 'b.txt')
    git(wt, 'commit', '-qm', 'b')
    writeFileSync(join(wt, 'README.md'), 'changed\n')
    // Someone else's ticket.
    git(repo, 'worktree', 'add', '-q', '-b', 'me/eng-1111', join(ws, 'api-wt', 'eng-1111'), 'origin/main')

    const found = await ticketBranches(ws, 'ENG-8825')
    expect(found).toEqual([
      {
        repo: 'api',
        branch: 'me/eng-8825',
        label: 'api-wt/eng-8825',
        slug: null,
        defaultBranch: 'main',
        pushed: true,
        remoteBranch: null,
        unpushed: 1,
        ahead: 2,
        changes: 1
      }
    ])
    expect(await ticketBranches(ws, 'ENG-2222')).toEqual([])
  })
})

describe("a PR taken over from someone else (real git)", () => {
  it("is found through the ticket's PR branch, and its push state comes from its upstream", async () => {
    // Someone else's PR on feat/importer; picked up in api-wt-8655 as me/importer-update tracking it.
    const root = realpathSync(tmp())
    const ws = join(root, 'ws')
    mkdirSync(ws)
    git(root, 'init', '-q', '--bare', 'remote.git')
    git(ws, 'init', '-q', 'api')
    const repo = join(ws, 'api')
    writeFileSync(join(repo, 'README.md'), 'hi\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-qm', 'init')
    git(repo, 'remote', 'add', 'origin', join(root, 'remote.git'))
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(repo, 'remote', 'set-head', 'origin', 'main')
    git(repo, 'branch', '-q', 'feat/importer')
    git(repo, 'push', '-q', 'origin', 'feat/importer')
    git(repo, 'fetch', '-q', 'origin')
    const wt = join(ws, 'api-wt-8655')
    git(repo, 'worktree', 'add', '-q', '--track', '-b', 'me/importer-update', wt, 'origin/feat/importer')
    // Another checkout tracking something else: not this ticket's.
    git(repo, 'worktree', 'add', '-q', '-b', 'me/other', join(ws, 'api-wt-other'), 'origin/main')
    // Make origin look like GitHub, so the PR's repo can be matched (refs are already local).
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/acme/api.git')

    const heads = [{ repo: 'acme/api', branch: 'feat/importer' }]
    expect(await ticketBranches(ws, 'ENG-8372')).toEqual([])
    const found = await ticketBranches(ws, 'ENG-8372', heads)
    expect(found).toMatchObject([{ repo: 'api', branch: 'me/importer-update', remoteBranch: 'feat/importer', label: 'api-wt-8655', pushed: true, unpushed: 0 }])
    // A PR in another repo doesn't match.
    expect(await ticketBranches(ws, 'ENG-8372', [{ repo: 'acme/web', branch: 'feat/importer' }])).toEqual([])
  })

  it('the line shows local → remote, links the remote branch, and names the PR', () => {
    const html = renderToStaticMarkup(
      <BranchLine branch={b({ branch: 'me/importer-update', remoteBranch: 'feat/importer' })} pr={{ repo: 'acme/api', number: 8655, url: 'u' }} />
    )
    expect(html).toContain('me/importer-update')
    expect(html).toContain('→ feat/importer')
    expect(html).toContain(`https://github.com/${b().slug}/tree/feat/importer`)
    expect(html).toContain('PR #8655')
  })
})
