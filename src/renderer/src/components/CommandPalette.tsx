import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BoardCard, SearchHit, SessionSummary } from '../../../shared/types'
import { folderName, timeAgo } from '../format'
import type { Nav } from './Sidebar'

interface Props {
  sessions: SessionSummary[]
  linearConnected: boolean
  onNav: (nav: Nav) => void
  onNewSession: () => void
  onOpenCard: (card: BoardCard) => void
  onClose: () => void
}

type Item =
  | { kind: 'view'; key: string; label: string; run: () => void }
  | { kind: 'session'; key: string; session: SessionSummary }
  | { kind: 'ticket'; key: string; card: BoardCard }
  | { kind: 'hit'; key: string; hit: SearchHit; session: SessionSummary | undefined }

const MAX_SESSIONS = 8
const MAX_TICKETS = 6
const MAX_HITS = 8

/** Every query word appears somewhere in `haystack`; earlier and word-start matches score higher. */
function score(haystack: string, terms: string[]): number {
  const h = haystack.toLowerCase()
  let total = 0
  for (const t of terms) {
    const i = h.indexOf(t)
    if (i < 0) return 0
    total += (i === 0 || /[\s/#-]/.test(h[i - 1]) ? 3 : 1) + 1 / (1 + i)
  }
  return total
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="hl">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

/** ⌘K: jump to any view, session or sprint ticket, or search every conversation. */
export function CommandPalette({ sessions, linearConnected, onNav, onNewSession, onOpenCard, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [cards, setCards] = useState<BoardCard[]>([])
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])

  useEffect(() => {
    if (linearConnected) window.desk.getBoard().then((b) => setCards(b.cards)).catch(() => {})
  }, [linearConnected])

  // Conversations: live, but only once there is enough to search for.
  useEffect(() => {
    if (query.trim().length < 3) return setHits([])
    setSearching(true)
    let live = true
    const t = setTimeout(() => {
      window.desk
        .searchTranscripts(query)
        .then((h) => live && setHits(h))
        .catch(() => live && setHits([]))
        .finally(() => live && setSearching(false))
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])

  const items = useMemo<Item[]>(() => {
    const views: Item[] = [
      { kind: 'view', key: 'v:new', label: 'New session', run: onNewSession },
      { kind: 'view', key: 'v:workflow', label: 'Workflow', run: () => onNav({ kind: 'workflow' }) },
      { kind: 'view', key: 'v:worktrees', label: 'Worktrees', run: () => onNav({ kind: 'worktrees' }) },
      { kind: 'view', key: 'v:branches', label: 'Branches', run: () => onNav({ kind: 'branches' }) },
      { kind: 'view', key: 'v:artifacts', label: 'Artifacts', run: () => onNav({ kind: 'artifacts' }) }
    ].filter((v) => !terms.length || score((v as { label: string }).label, terms) > 0) as Item[]
    const live = sessions.filter((s) => !s.archived)
    const ss = terms.length
      ? live
          .map((s) => ({ s, sc: score(`${s.title} ${s.tickets.join(' ')} ${folderName(s.startCwd)}`, terms) }))
          .filter((x) => x.sc > 0)
          .sort((a, b) => b.sc - a.sc || b.s.lastActivity - a.s.lastActivity)
          .map((x) => x.s)
      : live
    const tickets = terms.length
      ? cards.filter((c) => score(`${c.issue.identifier} ${c.issue.title}`, terms) > 0).slice(0, MAX_TICKETS)
      : []
    const byId = new Map(sessions.map((s) => [s.id, s]))
    return [
      ...views,
      ...ss.slice(0, MAX_SESSIONS).map((s): Item => ({ kind: 'session', key: `s:${s.id}`, session: s })),
      ...tickets.map((c): Item => ({ kind: 'ticket', key: `t:${c.issue.identifier}`, card: c })),
      // Only sessions the sidebar shows; scripted (SDK) runs have nothing to open.
      ...hits.filter((h) => byId.has(h.sessionId)).slice(0, MAX_HITS).map((h): Item => ({ kind: 'hit', key: `h:${h.sessionId}`, hit: h, session: byId.get(h.sessionId) }))
    ]
  }, [terms, sessions, cards, hits, onNav, onNewSession])

  useEffect(() => setSelected(0), [query])
  useEffect(() => {
    list.current?.querySelector('.palette-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const run = (item: Item | undefined) => {
    if (!item) return
    onClose()
    if (item.kind === 'view') item.run()
    else if (item.kind === 'session') onNav({ kind: 'session', id: item.session.id })
    else if (item.kind === 'ticket') onOpenCard(item.card)
    else onNav({ kind: 'session', id: item.hit.sessionId })
  }

  const section = (kind: Item['kind']) => ({ view: 'Go to', session: terms.length ? 'Sessions' : 'Recent sessions', ticket: 'Sprint tickets', hit: 'In conversations' })[kind]

  return createPortal(
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Jump to" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Jump to a session, ticket or view, or search conversations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((i) => Math.min(i + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(items[selected])
            } else if (e.key === 'Escape') onClose()
          }}
        />
        <div className="palette-list" ref={list}>
          {items.map((item, i) => (
            <div key={item.key}>
              {(i === 0 || items[i - 1].kind !== item.kind) && <div className="palette-section">{section(item.kind)}</div>}
              <button
                className={`palette-item ${i === selected ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => run(item)}
              >
                {item.kind === 'view' && <span className="palette-title">{item.label}</span>}
                {item.kind === 'session' && (
                  <>
                    <span className="palette-title">
                      <Highlight text={item.session.title} terms={terms} />
                    </span>
                    <span className="palette-meta">
                      {[item.session.tickets[0], folderName(item.session.startCwd), timeAgo(item.session.lastActivity)].filter(Boolean).join(' · ')}
                    </span>
                  </>
                )}
                {item.kind === 'ticket' && (
                  <>
                    <span className="palette-title">
                      <Highlight text={`${item.card.issue.identifier} ${item.card.issue.title}`} terms={terms} />
                    </span>
                    <span className="palette-meta">{item.card.sessionIds.length || item.card.prSessionIds.length ? 'open session' : 'start a session'}</span>
                  </>
                )}
                {item.kind === 'hit' && (
                  <>
                    <span className="palette-title">
                      {item.session?.title ?? item.hit.sessionId.slice(0, 8)}
                      <span className="palette-meta">
                        {' '}
                        · {item.hit.matches} message{item.hit.matches === 1 ? '' : 's'} · {timeAgo(item.hit.lastMatchAt)}
                      </span>
                    </span>
                    <span className="palette-snippet">
                      <span className="palette-role">{item.hit.snippets[0].role === 'you' ? 'You' : 'Claude'}:</span>{' '}
                      <Highlight text={item.hit.snippets[0].text} terms={terms} />
                    </span>
                  </>
                )}
              </button>
            </div>
          ))}
          {searching && query.trim().length >= 3 && <div className="palette-section muted">Searching conversations…</div>}
          {!items.length && !searching && <div className="palette-empty">Nothing matches “{query}”.</div>}
        </div>
        <div className="palette-foot">↑↓ to move · ↵ to open · esc to close · ⌘1–9 opens pinned sessions</div>
      </div>
    </div>,
    document.body
  )
}
