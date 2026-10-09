import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BranchInfo, BranchVerdict } from '../../../shared/types'
import { errorMessage, timeAgo } from '../format'
import { RefreshIcon } from './icons'
import { ExternalLink, TicketLink } from './links'

interface Props {
  actionsTarget: HTMLElement | null
  notify: (text: string, kind?: 'info' | 'error') => void
  onOpenSession: (id: string) => void
}

type Filter = 'all' | BranchVerdict

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'safe', label: 'Safe to delete' },
  { id: 'active', label: 'Active' },
  { id: 'blocked', label: 'Has work' },
  { id: 'protected', label: 'Default' }
]

const VERDICT_HINT: Record<BranchVerdict, string> = {
  safe: 'Every commit is in its merged or closed PR, or in the default branch: nothing would be lost',
  active: 'Still in use: an open PR, or pushed with no PR yet',
  blocked: 'Deleting it would lose commits, or it is checked out',
  protected: "The repo's default branch"
}

type Confirm = { kind: 'one'; b: BranchInfo } | { kind: 'bulk'; list: BranchInfo[] }

/**
 * Local branches of every repo in the project, with their ticket, PR and
 * sessions, and cleanup of the ones nothing would be lost from. Only branches
 * on this Mac are deleted; GitHub's are left as they are.
 */
export function Branches({ actionsTarget, notify, onOpenSession }: Props) {
  const [list, setList] = useState<BranchInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await window.desk.listBranches())
    } catch (e) {
      notify(errorMessage(e), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<BranchVerdict, number> = { safe: 0, active: 0, blocked: 0, protected: 0 }
    for (const b of list ?? []) c[b.verdict]++
    return c
  }, [list])

  const byRepo = useMemo(() => {
    const groups = new Map<string, BranchInfo[]>()
    for (const b of list ?? []) {
      if (filter !== 'all' && b.verdict !== filter) continue
      groups.set(b.repo, [...(groups.get(b.repo) ?? []), b])
    }
    for (const items of groups.values()) items.sort((a, b) => b.lastCommitAt - a.lastCommitAt)
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [list, filter])

  const safe = (list ?? []).filter((b) => b.verdict === 'safe')

  const remove = async (targets: BranchInfo[]) => {
    setConfirm(null)
    const failed: string[] = []
    const removed = new Set<string>()
    for (const [i, b] of targets.entries()) {
      setBusy(`Deleting ${i + 1} of ${targets.length}: ${b.branch}`)
      try {
        await window.desk.removeBranch(b.repoPath, b.branch)
        removed.add(`${b.repoPath}\0${b.branch}`)
      } catch (e) {
        failed.push(`${b.branch}: ${errorMessage(e)}`)
      }
    }
    setBusy(null)
    setList((l) => l?.filter((b) => !removed.has(`${b.repoPath}\0${b.branch}`)) ?? l)
    if (failed.length) notify(`Deleted ${removed.size}; ${failed.length} refused. ${failed[0]}`, 'error')
    else notify(`Deleted ${removed.size} local branch${removed.size === 1 ? '' : 'es'}; GitHub's are untouched`)
  }

  return (
    <div className="worktrees-view">
      {actionsTarget &&
        createPortal(
          <>
            {list && (
              <span className="topbar-meta">
                {list.length} branches · {counts.safe} safe to delete
              </span>
            )}
            <button
              className={`icon-button ${loading ? 'spinning' : ''}`}
              onClick={load}
              disabled={loading || !!busy}
              title="Check again"
              aria-label="Check again"
            >
              <RefreshIcon />
            </button>
            <button
              className="btn btn-small btn-primary"
              disabled={!safe.length || loading || !!busy}
              onClick={() => setConfirm({ kind: 'bulk', list: safe })}
            >
              Delete {safe.length} safe…
            </button>
          </>,
          actionsTarget
        )}

      <div className="filter-row">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`filter-chip ${filter === f.id ? 'on' : ''}`}
            onClick={() => setFilter(f.id)}
            title={f.id === 'all' ? undefined : VERDICT_HINT[f.id]}
          >
            {f.label}
            {list && <span className="count">{f.id === 'all' ? list.length : counts[f.id]}</span>}
          </button>
        ))}
        {busy && <span className="topbar-meta">{busy}</span>}
      </div>

      {!list && <p className="muted wt-empty">Checking every branch, and its PR on GitHub… this can take a minute for large repos.</p>}
      {list && byRepo.length === 0 && <p className="muted wt-empty">Nothing in this filter.</p>}

      <div className="wt-scroll">
        {byRepo.map(([repo, items]) => (
          <section key={repo} className="wt-repo">
            <h2>
              {repo} <span className="count">{items.length}</span>
            </h2>
            <table className="wt-table">
              <tbody>
                {items.map((b) => (
                  <tr key={b.branch} className={`wt-${b.verdict === 'protected' ? 'active' : b.verdict}`}>
                    <td className="wt-verdict" title={VERDICT_HINT[b.verdict]}>
                      <span className={`wt-dot wt-dot-${b.verdict === 'protected' ? 'active' : b.verdict}`} />
                    </td>
                    <td className="wt-path" title={b.sha}>
                      {b.branch}
                      <div className="wt-branch">
                        {b.upstreamGone
                          ? 'deleted on GitHub'
                          : b.upstream
                            ? b.upstream === b.branch
                              ? 'on GitHub'
                              : `tracks ${b.upstream}`
                            : 'not on GitHub'}
                        {b.checkedOutAt && ` · in ${b.checkedOutAt}`}
                      </div>
                    </td>
                    <td className="wt-links">
                      {b.ticket && <TicketLink ticket={b.ticket} />}
                      {b.pr && (
                        <ExternalLink href={b.pr.url} title={b.pr.state.toLowerCase()}>
                          #{b.pr.number}
                          <span className={`pr-badge pr-${b.pr.state === 'OPEN' ? (b.pr.draft ? 'draft' : 'open') : b.pr.state.toLowerCase()}`}>
                            {b.pr.state === 'OPEN' ? (b.pr.draft ? 'Draft' : 'Open') : b.pr.state === 'MERGED' ? 'Merged' : 'Closed'}
                          </span>
                        </ExternalLink>
                      )}
                      {b.sessionIds.length > 0 && (
                        <button className="link-button" title="Open its most recent session" onClick={() => onOpenSession(b.sessionIds[0])}>
                          {b.sessionIds.length} session{b.sessionIds.length === 1 ? '' : 's'}
                        </button>
                      )}
                    </td>
                    <td className="wt-reason">{b.reason}</td>
                    <td className="wt-time muted">{b.lastCommitAt ? timeAgo(b.lastCommitAt) : ''}</td>
                    <td className="wt-action">
                      {(b.verdict === 'safe' || b.verdict === 'active') && (
                        <button className="btn btn-small" disabled={!!busy} onClick={() => setConfirm({ kind: 'one', b })}>
                          Delete…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      {confirm && <ConfirmDelete confirm={confirm} onCancel={() => setConfirm(null)} onConfirm={remove} />}
    </div>
  )
}

function ConfirmDelete({
  confirm,
  onCancel,
  onConfirm
}: {
  confirm: Confirm
  onCancel: () => void
  onConfirm: (targets: BranchInfo[]) => void
}) {
  const targets = confirm.kind === 'one' ? [confirm.b] : confirm.list
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal modal-wide" role="alertdialog" aria-label="Delete branches" onMouseDown={(e) => e.stopPropagation()}>
        <h1>
          {confirm.kind === 'one'
            ? `Delete ${confirm.b.branch}?`
            : `Delete ${targets.length} local branch${targets.length === 1 ? '' : 'es'}?`}
        </h1>
        <p>
          {confirm.kind === 'one'
            ? `${confirm.b.reason}. `
            : 'Each has a merged or closed PR with all its commits, or is already in the default branch. '}
          Only the branches on this Mac are deleted; GitHub&rsquo;s are left as they are. Each is re-checked first, and git keeps
          the commits for about 90 days, so a deleted branch can be brought back from its last commit.
        </p>
        {confirm.kind === 'one' && confirm.b.verdict === 'active' && (
          <p className="warn">It&rsquo;s still in use upstream. Everything is on GitHub, so you can check it out again later.</p>
        )}
        {confirm.kind === 'bulk' && (
          <ul className="wt-confirm-list">
            {targets.map((b) => (
              <li key={`${b.repoPath}:${b.branch}`}>
                {b.repo} · {b.branch} <span className="muted">· {b.reason}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => onConfirm(targets)}>
            Delete{confirm.kind === 'bulk' ? ` ${targets.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
