import { describe, expect, it } from 'vitest'
import { ticketBrief } from '../src/main/ticketBrief'

describe('ticketBrief', () => {
  const issue = {
    identifier: 'ENG-8812',
    title: 'Dark mode for settings',
    url: 'https://linear.app/acme/issue/ENG-8812',
    branchName: 'me/eng-8812',
    description: 'Add a dark theme to the settings page.'
  }

  it("names the ticket, its worktree layout and Linear's branch", () => {
    const b = ticketBrief(issue, '/ws')
    expect(b).toContain('ENG-8812: Dark mode for settings')
    expect(b).toContain('https://linear.app/acme/issue/ENG-8812')
    expect(b).toContain('Add a dark theme to the settings page.')
    expect(b).toContain('/ws/REPO-wt/eng-8812 on branch me/eng-8812')
    expect(b).toContain('git -C /ws/REPO worktree add -b me/eng-8812 /ws/REPO-wt/eng-8812 origin/<default branch>')
    expect(b).toMatch(/never in a repository's main checkout/)
  })

  it('still briefs on the id alone when Linear is unavailable', () => {
    const b = ticketBrief({ identifier: 'ENG-7', title: '', url: '', branchName: '', description: '' }, '/ws')
    expect(b.split('\n')[0]).toBe('This session is for Linear ticket ENG-7')
    expect(b).toContain('The ticket has no description.')
    expect(b).toContain('on branch eng-7')
  })

  it('truncates very long descriptions', () => {
    const b = ticketBrief({ ...issue, description: 'x'.repeat(10_000) }, '/ws')
    expect(b).toContain('[…truncated]')
    expect(b.length).toBeLessThan(6000)
  })
})
