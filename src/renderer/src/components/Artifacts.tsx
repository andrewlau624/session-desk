import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ArtifactRecord, SessionSummary } from '../../../shared/types'
import { errorMessage, timeAgo } from '../format'
import { MoreIcon } from './icons'
import { ExternalLink, TicketLink } from './links'
import { PopupMenu } from './PopupMenu'

interface Props {
  sessions: SessionSummary[]
  onOpenSession: (id: string) => void
  notify: (text: string, kind?: 'info' | 'error') => void
}

/** Artifacts sessions published or opened, newest first, with their tickets and sessions. */
export function Artifacts({ sessions, onOpenSession, notify }: Props) {
  const [list, setList] = useState<ArtifactRecord[] | null>(null)
  const [showRemoved, setShowRemoved] = useState(false)
  const [menu, setMenu] = useState<{ anchor: HTMLElement; a: ArtifactRecord } | null>(null)
  const [deleting, setDeleting] = useState<ArtifactRecord | null>(null)
  const byId = new Map(sessions.map((s) => [s.id, s]))

  const setHidden = async (a: ArtifactRecord, hidden: boolean) => {
    try {
      await window.desk.setArtifactHidden(a.url, hidden)
      setList((l) => l?.map((x) => (x.url === a.url ? { ...x, hidden } : x)) ?? l)
      notify(hidden ? `Removed “${a.title || 'Untitled artifact'}” from the list` : 'Restored')
    } catch (e) {
      notify(errorMessage(e), 'error')
    }
  }

  useEffect(() => {
    window.desk
      .listArtifacts()
      .then(setList)
      .catch((e) => {
        notify(errorMessage(e), 'error')
        setList([])
      })
  }, [notify])

  if (!list) return <p className="muted wt-empty">Looking through session transcripts…</p>
  if (!list.length) return <p className="muted wt-empty">No session has published or opened an artifact yet.</p>

  const removed = list.filter((a) => a.hidden)
  const shown = list.filter((a) => !a.hidden || showRemoved)

  return (
    <div className="artifacts-view">
      <ul className="artifact-list">
        {shown.map((a) => (
          <li key={a.url} className={`artifact ${a.hidden ? 'removed' : ''}`}>
            <div className="artifact-head">
              <span className="artifact-title">{a.title || 'Untitled artifact'}</span>
              {!a.published && <span className="pr-badge">Opened only</span>}
              <span className="muted artifact-when" title={new Date(a.lastAt).toLocaleString()}>
                {timeAgo(a.lastAt)}
              </span>
              <ExternalLink href={a.url} className="artifact-open">
                Open ↗
              </ExternalLink>
              <button
                className="icon-button artifact-more"
                aria-label={`Actions for ${a.title || 'artifact'}`}
                onClick={(e) => setMenu({ anchor: e.currentTarget, a })}
              >
                <MoreIcon />
              </button>
            </div>
            {a.description && <div className="artifact-desc">{a.description}</div>}
            <div className="artifact-links">
              {a.tickets.map((t) => (
                <TicketLink key={t} ticket={t} className="chip" />
              ))}
              {a.sessions.map((s) => {
                const session = byId.get(s.id)
                return (
                  <button
                    key={s.id}
                    className="link-button artifact-session"
                    disabled={!session}
                    title={session ? `Open ${session.title}` : 'That session is no longer listed'}
                    onClick={() => onOpenSession(s.id)}
                  >
                    {s.kind === 'publish' ? 'From' : 'Opened in'} {session?.title ?? s.id.slice(0, 8)}
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
      {removed.length > 0 && (
        <button className="link-button artifacts-removed" onClick={() => setShowRemoved((v) => !v)}>
          {showRemoved ? 'Hide removed' : `Show ${removed.length} removed`}
        </button>
      )}

      {menu && (
        <PopupMenu
          anchor={menu.anchor}
          align="right"
          onClose={() => setMenu(null)}
          entries={[
            { label: 'Open on claude.ai', onSelect: () => window.desk.openExternal(menu.a.url) },
            menu.a.hidden
              ? { label: 'Restore to list', onSelect: () => setHidden(menu.a, false) }
              : { label: 'Remove from list', onSelect: () => setHidden(menu.a, true) },
            'divider',
            { label: 'Delete on claude.ai…', danger: true, onSelect: () => setDeleting(menu.a) }
          ]}
        />
      )}

      {deleting &&
        createPortal(
          <div className="modal-backdrop" onMouseDown={() => setDeleting(null)}>
            <div className="modal" role="alertdialog" aria-label="Delete artifact" onMouseDown={(e) => e.stopPropagation()}>
              <h1>Delete “{deleting.title || 'Untitled artifact'}”?</h1>
              <p>
                Session Desk can't delete artifacts itself; claude.ai owns them. This opens it on claude.ai, where you can
                delete it. Deleting stops its link working for everyone it was shared with. It is also removed from this list.
              </p>
              <div className="modal-actions">
                <button className="btn" autoFocus onClick={() => setDeleting(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    window.desk.openExternal(deleting.url)
                    if (!deleting.hidden) setHidden(deleting, true)
                    setDeleting(null)
                  }}
                >
                  Open on claude.ai
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
