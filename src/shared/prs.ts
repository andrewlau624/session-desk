import type { PrLink } from './types'

/**
 * Whether a PR is the ticket's own work rather than one attached for context:
 * its branch, title or description names the ticket. Until GitHub has
 * answered it counts as the ticket's own, as everything attached used to.
 */
export function namesTicket(pr: PrLink, ticket: string): boolean {
  const mentions = pr.info?.mentions
  return !mentions || mentions.includes(ticket.toUpperCase())
}
