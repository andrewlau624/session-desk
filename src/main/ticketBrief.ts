import { basename, dirname } from 'node:path'
import type { Kickoff, LinearIssue, PrBranch } from '../shared/types'

const DESCRIPTION_LIMIT = 4000

/** A ticket's worktree path from the project's layout, relative to the folder holding the repo. */
export function worktreePath(layout: string, repo: string, ticket: string): string {
  return layout.replaceAll('{repo}', repo).replaceAll('{ticket}', ticket.toLowerCase())
}

/**
 * System-prompt addition for a session started from a ticket. It has Claude
 * work only in per-ticket worktrees, laid out by the project's `worktrees`
 * setting beside each repo. A project folder holding several repos has Claude
 * pick the ones the change belongs in; one that is itself a repo has just that one.
 */
export function ticketBrief(
  issue: Pick<LinearIssue, 'identifier' | 'title' | 'url' | 'branchName' | 'description'>,
  workspace: string,
  project: { layout: string; singleRepo: boolean } = { layout: '{repo}-wt/{ticket}', singleRepo: false }
): string {
  const slug = issue.identifier.toLowerCase()
  // Linear's suggested branch; without Linear details, the bare identifier.
  const branch = issue.branchName || slug
  const description = issue.description.trim()
  const header = [
    `This session is for Linear ticket ${issue.identifier}${issue.title ? `: ${issue.title}` : ''}`,
    ...(issue.url ? [issue.url] : []),
    '',
    description
      ? `Ticket description:\n${description.length > DESCRIPTION_LIMIT ? description.slice(0, DESCRIPTION_LIMIT) + '\n[…truncated]' : description}`
      : 'The ticket has no description.',
    ''
  ]
  if (project.singleRepo) {
    // The repo is the project folder; worktrees go beside it.
    const tree = `${dirname(workspace)}/${worktreePath(project.layout, basename(workspace), slug)}`
    return [
      ...header,
      `This project is the git repository at ${workspace}. Work on this ticket happens in a git worktree, never in the main checkout:`,
      `1. Use the worktree at ${tree} on branch ${branch}.`,
      `   If it exists, reuse it. Otherwise fetch first (git -C ${workspace} fetch origin), then create it from the up-to-date default branch:`,
      `   git -C ${workspace} worktree add -b ${branch} ${tree} origin/<default branch>`,
      `   (if the branch already exists, add the worktree on it without -b).`,
      `2. Make every edit, build and test inside that worktree. Leave the main checkout untouched.`,
      `3. Say which worktree you are using when you start.`
    ].join('\n')
  }
  const tree = `${workspace}/${worktreePath(project.layout, 'REPO', slug)}`
  return [
    ...header,
    `${workspace} holds several git repositories side by side. Work on this ticket happens in git worktrees, never in a repository's main checkout:`,
    `1. Before changing any code, work out which repositories the change belongs in. Repos you only read need no worktree.`,
    `2. For each repository REPO you will change, use the worktree at ${tree} on branch ${branch}.`,
    `   If it exists, reuse it. Otherwise fetch first (git -C ${workspace}/REPO fetch origin), then create it from the up-to-date default branch:`,
    `   git -C ${workspace}/REPO worktree add -b ${branch} ${tree} origin/<default branch>`,
    `   (if the branch already exists, add the worktree on it without -b).`,
    `3. Make every edit, build and test inside those worktrees. Leave the main checkouts untouched.`,
    `4. Say which worktrees you are using when you start.`
  ].join('\n')
}

export const KICKOFFS: readonly Kickoff[] = ['plan', 'replan', 'represent', 'continue', 'open-pr']
/** These run in plan mode: Claude can read but not edit until you approve. */
export const PLAN_KICKOFFS: ReadonlySet<Kickoff> = new Set(['plan', 'replan', 'represent'])

// Names that come from local git; anything else (spaces, quotes, newlines) is refused.
const REF_RE = /^[\w.@/+-]{1,200}$/

/** A branch fit to name in a prompt, or null. */
export function validPrBranch(b: unknown): PrBranch | null {
  const v = b as Partial<PrBranch> | null
  return v && [v.repo, v.branch, v.label].every((x) => typeof x === 'string' && REF_RE.test(x))
    ? { repo: v.repo!, branch: v.branch!, label: v.label! }
    : null
}

/** The opening turn when a ticket's card moves into In Progress (see Kickoff), or Create PR is clicked. */
export function kickoffPrompt(kind: Kickoff, ticket: string, pr?: PrBranch | null): string {
  switch (kind) {
    case 'open-pr':
      // Asked as you would ask it, so the PR gets your usual title and description.
      return `Open a pull request for ${ticket} from the ${pr?.branch} branch of ${pr?.repo} (checked out at ${pr?.label}). Push any commits that aren't on GitHub yet first, then create the PR with the title and description you'd normally write for me.`
    case 'plan':
      return `Plan the work for ${ticket}. The ticket and its description are in your instructions. Read the code it touches first. If the ticket leaves something the plan depends on unclear, ask me before finishing the plan.`
    case 'replan':
      return `${ticket} is now In Progress. Make a plan for it, building on what we've already discussed here. If something the plan depends on is unclear, ask me.`
    case 'represent':
      return `${ticket} is In Progress again. Your plan for it was never approved: present it again for my approval, updated if anything has changed since.`
    case 'continue':
      return `${ticket} is In Progress again. Continue where you left off. If you need a decision or information from me, ask.`
  }
}
