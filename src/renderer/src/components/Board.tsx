import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { COLUMNS, type Board as BoardData, type BoardCard, type Column, type PrLink } from '../../../shared/types'
import { errorMessage } from '../format'
import { RefreshIcon } from './icons'
import { DeployLine, ExternalLink, PrBadge, PrStatusLine } from './links'

interface Props {
  connected: boolean
  running: Set<string>
  onOpenCard: (card: BoardCard) => void
  /** A card was moved into In Progress here: plan or continue its work. */
  onStartWork: (card: BoardCard) => void
  onConnect: () => void
  onOpenSettings: () => void
  /** Top-bar node to render the cycle and Refresh into. */
  actionsTarget: HTMLElement | null
}

const REFRESH_MS = 60_000

export function Board({ connected, running, onOpenCard, onStartWork, onConnect, onOpenSettings, actionsTarget }: Props) {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState<Column | null>(null)
  // Waiting Response depends on the status hook; say so when it's missing.
  const [hookOk, setHookOk] = useState(true)
  useEffect(() => {
    window.desk.hookStatus().then((h) => setHookOk(h.state === 'installed'), () => {})
  }, [])

  const load = useCallback(async () => {
    if (!connected) return
    setLoading(true)
    try {
      setBoard(await window.desk.getBoard())
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [connected])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    const off = window.desk.onSessionsChanged(load)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [load])

  const move = async (identifier: string, column: Column) => {
    if (!board) return
    const before = board
    const card = board.cards.find((c) => c.issue.identifier === identifier)
    if (!card || card.column === column) return
    // Optimistic: show the move now, roll back if Linear refuses it.
    setBoard({ ...board, cards: board.cards.map((c) => (c === card ? { ...c, column } : c)) })
    try {
      setBoard(await window.desk.moveCard(identifier, column))
      setError(null)
      // Only once Linear has it: a refused move starts nothing.
      if (column === 'in_progress') onStartWork(card)
    } catch (e) {
      setBoard(before)
      setError(`Couldn't move ${identifier}: ${errorMessage(e)}`)
    }
  }

  if (!connected) {
    return (
      <div className="placeholder">
        <p>Connect Linear to see your sprint.</p>
        <button className="btn btn-primary" onClick={onConnect}>
          Connect Linear
        </button>
      </div>
    )
  }

  return (
    <div className="board-view">
      {actionsTarget &&
        createPortal(
          <>
            {board?.automation && <AutomationChip automation={board.automation} />}
            {board?.cycle && (
              <span className="topbar-meta">
                Cycle {board.cycle.number} · ends{' '}
                {new Date(board.cycle.endsAt).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric'
                })}
              </span>
            )}
            <button
              className={`icon-button ${loading ? 'spinning' : ''}`}
              onClick={load}
              disabled={loading}
              title="Refresh from Linear"
              aria-label="Refresh from Linear"
            >
              <RefreshIcon />
            </button>
          </>,
          actionsTarget
        )}
      {!hookOk && (
        <div className="hook-nudge">
          Waiting Response needs the Claude Code status hook, which isn’t installed for you yet.{' '}
          <button className="link-button" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}
      {error && <div className="banner-error">{error}</div>}
      {board && !board.cycle && board.cards.length === 0 && (
        <p className="muted board-empty">
          {board.noCycles ? 'No open issues assigned to you.' : 'No issues assigned to you in an active cycle.'}
        </p>
      )}
      <div className="board">
        {COLUMNS.map((col) => {
          const cards = board?.cards.filter((c) => c.column === col.id) ?? []
          return (
            <section
              key={col.id}
              className={`column ${dragOver === col.id ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(col.id)
              }}
              onDragLeave={() => setDragOver((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                move(e.dataTransfer.getData('text/plain'), col.id)
              }}
            >
              <h2>
                {col.label} <span className="count">{cards.length}</span>
              </h2>
              <div className="cards">
                {cards.map((card) => (
                  <Card
                    key={card.issue.id}
                    card={card}
                    running={card.sessionIds.some((id) => running.has(id))}
                    onOpen={() => onOpenCard(card)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Card({ card, running, onOpen }: { card: BoardCard; running: boolean; onOpen: () => void }) {
  const { issue } = card
  return (
    <article
      className="card"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', issue.identifier)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      title={
        card.sessionIds.length
          ? 'Open session'
          : card.prSessionIds.length
            ? 'Open the session that opened its PR'
            : 'Start a session for this ticket'
      }
    >
      <div className="card-top">
        <ExternalLink href={issue.url} className="card-id">
          {issue.identifier}
        </ExternalLink>
        {running && <span className="dot dot-running" title="Session running" />}
      </div>
      <div className="card-title">{issue.title}</div>
      {card.prs.length > 0 && (
        <ul className="card-prs">
          {card.prs.map((pr) => (
            <li key={pr.url}>
              <ExternalLink href={pr.url}>
                {pr.repo.split('/').pop()}#{pr.number}
              </ExternalLink>
              <PrBadge pr={pr} />
              <PrStatusLine pr={pr} compact />
              <DeployLine pr={pr} compact />
            </li>
          ))}
        </ul>
      )}
      {card.relatedPrs.length > 0 && <RelatedPrs prs={card.relatedPrs} ticket={issue.identifier} />}
      <div className="card-foot">
        {card.sessionIds.length === 0
          ? card.prSessionIds.length
            ? 'PR from another session'
            : 'No session yet'
          : card.sessionIds.length === 1
            ? '1 session'
            : `${card.sessionIds.length} sessions`}
      </div>
    </article>
  )
}

/** PRs attached for context (e.g. the one that caused a bug): muted, without a state chip. */
function RelatedPrs({ prs, ticket }: { prs: PrLink[]; ticket: string }) {
  return (
    <div className="card-related" title={`Attached to ${ticket} in Linear, but these PRs don't name it: context, not its work`}>
      Related:{' '}
      {prs.map((pr, i) => (
        <span key={pr.url}>
          {i > 0 && ', '}
          <ExternalLink href={pr.url}>
            {pr.repo.split('/').pop()}#{pr.number}
          </ExternalLink>
          {pr.info && ` (${pr.info.state.toLowerCase()})`}
        </span>
      ))}
    </div>
  )
}

/** Which tickets move by themselves, and who moves them. Settings live in the Session Desk menu. */
function AutomationChip({ automation }: { automation: NonNullable<BoardData['automation']> }) {
  const ours = [automation.start && 'To Do → In Progress', automation.review && 'In Progress → In Review'].filter(Boolean)
  const theirs = automation.linear.map((r) => `PR ${r.event} → ${r.state}`)
  const title = [
    ours.length ? `Session Desk moves: ${ours.join('; ')}` : 'Session Desk moves nothing (Session Desk menu → Linear Automation)',
    theirs.length ? `Linear itself moves: ${theirs.join('; ')}` : 'Linear has no GitHub rules for this team'
  ].join('\n')
  return (
    <span className="topbar-meta" title={title}>
      {ours.length ? `Auto: ${ours.length} rule${ours.length > 1 ? 's' : ''}` : 'Auto: off'}
      {theirs.length ? ` · Linear: ${theirs.length}` : ''}
    </span>
  )
}
