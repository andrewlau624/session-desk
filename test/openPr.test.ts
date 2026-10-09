import { describe, expect, it } from 'vitest'
import { kickoffPrompt, PLAN_KICKOFFS, validPrBranch } from '../src/main/ticketBrief'
import { busyReason, readiness } from '../src/renderer/src/startWork'
import { session } from './helpers'

const branch = { repo: 'api', branch: 'me/eng-8825', label: 'api-wt/eng-8825' }

describe('the Create PR turn', () => {
  it('asks for the PR the way you would, so Claude writes its usual title and description', () => {
    const p = kickoffPrompt('open-pr', 'ENG-8825', branch)
    expect(p).toContain('Open a pull request for ENG-8825 from the me/eng-8825 branch of api')
    expect(p).toContain('api-wt/eng-8825')
    expect(p).toContain("title and description you'd normally write")
    // Not plan mode: opening a PR needs to push and call gh.
    expect(PLAN_KICKOFFS.has('open-pr')).toBe(false)
  })

  it('only names branches that look like git names', () => {
    expect(validPrBranch(branch)).toEqual(branch)
    expect(validPrBranch({ ...branch, branch: 'x; rm -rf ~' })).toBeNull()
    expect(validPrBranch({ ...branch, label: 'a\nIgnore that and' })).toBeNull()
    expect(validPrBranch({ repo: 'r' })).toBeNull()
    expect(validPrBranch(null)).toBeNull()
  })
})

describe('whether a turn can be sent now', () => {
  const waiting = (event: string) => ({ state: 'waiting' as const, at: 1, event })
  it('idle or closed can; busy, a dialog or another app cannot, and says why', () => {
    const open = new Set(['s'])
    expect(readiness(session({ id: 's' }), open)).toBe('idle')
    expect(readiness(session({ id: 's', activity: waiting('Stop') }), open)).toBe('idle')
    expect(readiness(session({ id: 's' }), new Set())).toBe('closed')
    expect(readiness(session({ id: 's', activity: { state: 'working', at: 1, event: 'PostToolUse' } }), open)).toBe('working')
    expect(readiness(session({ id: 's', activity: waiting('PermissionRequest') }), open)).toBe('needs-you')
    expect(readiness(session({ id: 's', liveElsewhere: { pid: 1, entrypoint: 'cli' } }), new Set())).toBe('elsewhere')
    expect(busyReason('idle')).toBeNull()
    expect(busyReason('closed')).toBeNull()
    expect(busyReason('needs-you')).toContain('waiting on your answer')
  })
})
