import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeployInfo, GreptileStatus, PrLink } from '../../../shared/types'
import { linearUrl, timeAgo } from '../format'

export function ExternalLink({
  href,
  className,
  title,
  children
}: {
  href: string
  className?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      draggable={false}
      onClick={(e) => {
        // Links sit inside clickable cards; open the link, not the card.
        e.preventDefault()
        e.stopPropagation()
        window.desk.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

export function PrBadge({ pr }: { pr: PrLink }) {
  if (!pr.info) return null
  const { state, draft } = pr.info
  const label = state === 'OPEN' ? (draft ? 'Draft' : 'Open') : state === 'MERGED' ? 'Merged' : 'Closed'
  return <span className={`pr-badge pr-${label.toLowerCase()}`}>{label}</span>
}

const CHECKS_LABEL = { passing: '✓ Checks passing', failing: '✗ Checks failing', running: '● Checks running', none: '' } as const
const REVIEW_LABEL = { approved: 'Approved', changes_requested: 'Changes requested', review_required: 'Review required' } as const

function greptileLabel(g: GreptileStatus): string {
  switch (g.state) {
    case 'absent':
      return ''
    case 'none':
      return 'Not reviewed by Greptile'
    case 'requested':
      return `Greptile review requested ${timeAgo(Date.parse(g.at))} ago`.replace(' now ago', ' just now')
    case 'current':
      return `Greptile ${g.confidence ?? '?'}/5, up to date`
    case 'behind':
      return g.behindBy === null
        ? 'Greptile reviewed an older version'
        : `Greptile ${g.behindBy} commit${g.behindBy === 1 ? '' : 's'} behind`
  }
}

/**
 * Checks, review decision, unresolved threads and Greptile for an open PR.
 * `compact` drops the satisfied items (for board cards).
 */
export function PrStatusLine({ pr, compact }: { pr: PrLink; compact?: boolean }) {
  const s = pr.info?.status
  if (!s || pr.info?.state !== 'OPEN') return null
  const stale = s.greptile.state === 'behind' || s.greptile.state === 'none'
  const items: { text: string; tone: string; title?: string }[] = []
  if (s.checks !== 'none' && !(compact && s.checks === 'passing')) {
    items.push({ text: CHECKS_LABEL[s.checks], tone: s.checks === 'passing' ? 'ok' : s.checks === 'failing' ? 'bad' : 'warn' })
  }
  if (s.review && !compact) {
    items.push({ text: REVIEW_LABEL[s.review], tone: s.review === 'approved' ? 'ok' : s.review === 'changes_requested' ? 'bad' : 'muted' })
  } else if (s.review === 'changes_requested') {
    items.push({ text: REVIEW_LABEL[s.review], tone: 'bad' })
  }
  // The checkout has commits the PR doesn't: they were never pushed.
  const l = pr.local
  if (l && l.ahead && l.ahead > 0) {
    items.push({
      text: compact ? `${l.ahead} unpushed` : `${l.ahead} local commit${l.ahead === 1 ? '' : 's'} not pushed`,
      tone: 'bad',
      title: `${l.worktree} has commits the PR on GitHub doesn't`
    })
  } else if (l && l.ahead === null) {
    items.push({ text: compact ? 'Local differs' : 'Local branch differs from the PR', tone: 'warn', title: `${l.worktree}: fetch to compare` })
  }
  if (l && !compact && l.behind && l.behind > 0) {
    items.push({ text: `${l.behind} newer on GitHub`, tone: 'muted', title: `${l.worktree} is behind the PR` })
  }
  if (s.unresolvedThreads > 0) {
    items.push({ text: `${s.unresolvedThreads} unresolved`, tone: 'warn', title: 'Review threads not marked resolved' })
  }
  if (s.greptile.state !== 'absent' && (!compact || stale || s.greptile.state === 'requested')) {
    items.push({ text: compact && stale ? (s.greptile.state === 'none' ? 'No Greptile' : 'Greptile stale') : greptileLabel(s.greptile), tone: stale ? 'warn' : 'muted', title: greptileLabel(s.greptile) })
  }
  if (!items.length && !stale) return null
  return (
    <span className={`pr-status ${compact ? 'compact' : ''}`}>
      {items.map((i) => (
        <span key={i.text} className={`pr-status-item tone-${i.tone}`} title={i.title}>
          {i.text}
        </span>
      ))}
      {stale && !compact && <GreptileButton pr={pr} />}
    </span>
  )
}

/** Posts `@greptileai review` after an in-app confirmation. */
function GreptileButton({ pr }: { pr: PrLink }) {
  const [confirming, setConfirming] = useState(false)
  const [state, setState] = useState<'idle' | 'posting' | 'done' | string>('idle')
  const name = `${pr.repo.split('/').pop()}#${pr.number}`
  const post = async () => {
    setState('posting')
    try {
      await window.desk.requestGreptileReview(pr.url)
      setState('done')
      setConfirming(false)
    } catch (e) {
      setState(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }
  if (state === 'done') return <span className="pr-status-item tone-muted">Asked</span>
  return (
    <>
      <button
        className="link-button"
        onClick={(e) => {
          e.stopPropagation()
          setConfirming(true)
        }}
      >
        Ask Greptile to review
      </button>
      {confirming &&
        createPortal(
          <div className="modal-backdrop" onMouseDown={() => setConfirming(false)}>
            <div className="modal" role="alertdialog" aria-label="Ask Greptile" onMouseDown={(e) => e.stopPropagation()}>
              <h1>Ask Greptile to review {name}?</h1>
              <p>
                This posts a comment on the PR as you, reading exactly <code>@greptileai review</code>, which asks Greptile to
                review the PR as it is now.
              </p>
              {state !== 'idle' && state !== 'posting' && <div className="form-error">{state}</div>}
              <div className="modal-actions">
                <button className="btn" autoFocus onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={state === 'posting'} onClick={post}>
                  {state === 'posting' ? 'Posting…' : 'Post comment'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

type DeployEnv = DeployInfo[number]['envs'][number]
type Item = { text: string; tone: string; title: string }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * One service's state across its environments, the first being production:
 * "✓ In prod", "On staging, not in prod yet", "Not deployed yet". Where
 * production can't be read, the nearest tracked environment speaks instead.
 * `compact` (board cards) says only what isn't in production.
 */
export function deployItem(envs: DeployEnv[], compact: boolean): Item | null {
  const [prod, ...others] = envs
  if (!prod) return null
  const p = prod.state
  if (p.state === 'live') {
    return compact ? null : { text: `✓ In ${prod.label}`, tone: 'ok', title: `In ${p.tag}, which ${prod.label} runs` }
  }
  if (p.state === 'pending') {
    // The environment nearest production (config order) that has it.
    const live = others.find((e) => e.state.state === 'live')
    if (compact) return { text: `Not in ${prod.label}`, tone: 'warn', title: `${cap(prod.label)} runs ${p.tag}` }
    return live && live.state.state === 'live'
      ? { text: `On ${live.label}, not in ${prod.label} yet`, tone: 'warn', title: `${cap(live.label)} runs ${live.state.tag}; ${prod.label} runs ${p.tag}` }
      : { text: 'Not deployed yet', tone: 'warn', title: `Not in ${p.tag} (${prod.label}) or another environment's release` }
  }
  if (p.state === 'untracked' && !compact) {
    const near = others.find((e) => e.state.state === 'live' || e.state.state === 'pending')
    if (!near) return null
    const why = p.why ? `${cap(prod.label)} for this repo is a ${p.why}; nothing reliable to read` : ''
    return near.state.state === 'live'
      ? { text: `On ${near.label}${p.why ? ` · ${prod.label} not tracked (${p.why})` : ''}`, tone: 'muted', title: why }
      : { text: `Not on ${near.label} yet`, tone: 'warn', title: why }
  }
  return null
}

/**
 * Where a merged PR is live, per service it touched (a monorepo shows each:
 * "api: In prod · web: Not deployed yet"). Environments and their labels come
 * from the project's .session-desk.json.
 */
export function DeployLine({ pr, compact }: { pr: PrLink; compact?: boolean }) {
  const d = pr.deploy
  if (!d?.length || pr.info?.state !== 'MERGED') return null
  const items = d.flatMap((svc) => {
    const item = deployItem(svc.envs, !!compact)
    return item ? [{ ...item, text: svc.service ? `${svc.service}: ${item.text}` : item.text, key: svc.service ?? '' }] : []
  })
  if (!items.length) return null
  return (
    <span className={`pr-status ${compact ? 'compact' : ''}`}>
      {items.map((item) => (
        <span key={item.key} className={`pr-status-item tone-${item.tone}`} title={item.title}>
          {item.text}
        </span>
      ))}
    </span>
  )
}

/** A ticket id, linked to Linear when the workspace is known (or `url` is given). */
export function TicketLink({ ticket, url, className }: { ticket: string; url?: string; className?: string }) {
  const href = url ?? linearUrl(ticket)
  return href ? (
    <ExternalLink href={href} className={className}>
      {ticket}
    </ExternalLink>
  ) : (
    <span className={className}>{ticket}</span>
  )
}
