import type { GreptileStatus } from '../shared/types'

export interface PrComment {
  author: string | null
  body: string
  updatedAt: string
}

const SUMMARY_MARKER = '<!-- greptile_summary -->'
const TRIGGER_RE = /^@greptileai\b/i
// The summary's footer links the commit: "Last reviewed commit: [msg](…/commit/<sha>)".
const LAST_REVIEWED_RE = /Last reviewed commit:[^\n]*?\/commit\/([0-9a-f]{7,40})|Last reviewed commit:\s*`?([0-9a-f]{7,40})/i
const CONFIDENCE_RE = /Confidence Score:\s*(\d)\s*\/\s*5/i

/**
 * Greptile's standing on a PR, from its issue comments. Only a summary comment
 * is a review; `<!-- greptile-status -->` notices ("Automatic reviews are
 * disabled") are not. `commitOids` are the PR's commits, oldest first.
 */
export function greptileStatus(comments: PrComment[], headOid: string, commitOids: string[]): GreptileStatus {
  const latest = (xs: PrComment[]) => xs.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1)
  const summary = latest(comments.filter((c) => (c.author ?? '').startsWith('greptile') && c.body.includes(SUMMARY_MARKER)))
  const trigger = latest(comments.filter((c) => TRIGGER_RE.test(c.body.trim())))

  if (trigger && (!summary || trigger.updatedAt > summary.updatedAt)) return { state: 'requested', at: trigger.updatedAt }
  // Any Greptile comment (a review, or a "reviews are disabled" notice) means
  // it's installed on the repo. None at all: it isn't, so there's nothing to say.
  if (!comments.some((c) => (c.author ?? '').startsWith('greptile'))) return { state: 'absent' }
  if (!summary) return { state: 'none' }

  const m = LAST_REVIEWED_RE.exec(summary.body)
  const reviewed = (m?.[1] ?? m?.[2] ?? '').toLowerCase()
  const c = CONFIDENCE_RE.exec(summary.body)
  const confidence = c ? Number(c[1]) : null
  if (reviewed && headOid.toLowerCase().startsWith(reviewed)) return { state: 'current', confidence }
  // No readable commit counts as behind: better to ask again than trust it.
  const idx = reviewed ? commitOids.findIndex((o) => o.toLowerCase().startsWith(reviewed)) : -1
  return { state: 'behind', behindBy: idx >= 0 ? commitOids.length - 1 - idx : null, confidence }
}
