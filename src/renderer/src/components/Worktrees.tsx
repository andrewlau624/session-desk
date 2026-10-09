import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WorktreeInfo, WorktreeVerdict } from '../../../shared/types'
import { errorMessage, timeAgo } from '../format'
import { RefreshIcon } from './icons'
import { ExternalLink, TicketLink } from './links'

interface Props {
  actionsTarget: HTMLElement | null
  notify: (text: string, kind?: 'info' | 'error') => void
}

type Filter = 'all' | WorktreeVerdict

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'safe', label: 'Safe to remove' },
  { id: 'active', label: 'Active' },
  { id: 'blocked', label: 'Has work' },
  { id: 'missing', label: 'Missing' }
]

const VERDICT_HINT: Record<WorktreeVerdict, string> = {
  safe: 'Nothing would be lost',
  active: 'All pushed, still in use upstream',
  blocked: 'Removing it would lose work, or something runs in it',
  missing: 'Folder is gone; git still lists it'
}

type Confirm = { kind: 'one'; w: WorktreeInfo } | { kind: 'bulk'; list: WorktreeInfo[] }

export function Worktrees({ actionsTarget, notify }: Props) {
  const [list, setList] = useState<WorktreeInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await window.desk.listWorktrees())
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
    const c: Record<WorktreeVerdict, number> = { safe: 0, active: 0, blocked: 0, missing: 0 }
    for (const w of list ?? []) c[w.verdict]++
    return c
  }, [list])

  const byRepo = useMemo(() => {
    const groups = new Map<string, WorktreeInfo[]>()
    for (const w of list ?? []) {
      if (filter !== 'all' && w.verdict !== filter) continue
      groups.set(w.repo, [...(groups.get(w.repo) ?? []), w])
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [list, filter])

  const safe = (list ?? []).filter((w) => w.verdict === 'safe')

  const remove = async (targets: WorktreeInfo[], deleteBranches: boolean) => {
    setConfirm(null)
    const failed: string[] = []
    const removed = new Set<string>()
    let branches = 0
    for (const [i, w] of targets.entries()) {
      setBusy(`Removing ${i + 1} of ${targets.length}: ${w.label}`)
      try {
        const r = await window.desk.removeWorktree(w.path, deleteBranches)
        removed.add(w.path)
        if (r.branchDeleted) branches++
      } catch (e) {
        failed.push(`${w.label}: ${errorMessage(e)}`)
      }
    }
    setBusy(null)
    setList((l) => l?.filter((w) => !removed.has(w.path)) ?? l)
    if (failed.length) notify(`Removed ${removed.size}; ${failed.length} refused. ${failed[0]}`, 'error')
    else
      notify(
        `Removed ${removed.size} worktree${removed.size === 1 ? '' : 's'}` +
          (deleteBranches ? ` and ${branches} branch${branches === 1 ? '' : 'es'}` : '; branches kept')
      )
  }

  const prune = async (repoPath: string) => {
    try {
      await window.desk.pruneWorktrees(repoPath)
      setList((l) => l?.filter((w) => !(w.repoPath === repoPath && w.missing)) ?? l)
      notify('Cleared stale entries')
    } catch (e) {
      notify(errorMessage(e), 'error')
    }
  }

  return (
    <div className="worktrees-view">
      {actionsTarget &&
        createPortal(
          <>
            {list && (
              <span className="topbar-meta">
                {list.length} worktrees · {counts.safe} safe to remove
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
              Remove {safe.length} safe…
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

      {!list && <p className="muted wt-empty">Checking every worktree under the workspace… this takes about 20 seconds.</p>}
      {list && byRepo.length === 0 && <p className="muted wt-empty">Nothing in this filter.</p>}

      <div className="wt-scroll">
        {byRepo.map(([repo, items]) => (
          <section key={repo} className="wt-repo">
            <h2>
              {repo} <span className="count">{items.length}</span>
              {items.some((w) => w.missing) && (
                <button className="link-button" onClick={() => prune(items[0].repoPath)}>
                  Clear stale entries
                </button>
              )}
            </h2>
            <table className="wt-table">
              <tbody>
                {items.map((w) => (
                  <tr key={w.path} className={`wt-${w.verdict}`}>
                    <td className="wt-verdict" title={VERDICT_HINT[w.verdict]}>
                      <span className={`wt-dot wt-dot-${w.verdict}`} />
                    </td>
                    <td className="wt-path" title={w.path}>
                      {w.label}
                      <div className="wt-branch">{w.branch ?? 'detached HEAD'}</div>
                    </td>
                    <td className="wt-links">
                      {w.ticket && <TicketLink ticket={w.ticket} />}
                      {w.pr && (
                        <ExternalLink href={w.pr.url} title={w.pr.state.toLowerCase()}>
                          #{w.pr.number}
                          <span className={`pr-badge pr-${w.pr.state === 'OPEN' ? (w.pr.draft ? 'draft' : 'open') : w.pr.state.toLowerCase()}`}>
                            {w.pr.state === 'OPEN' ? (w.pr.draft ? 'Draft' : 'Open') : w.pr.state === 'MERGED' ? 'Merged' : 'Closed'}
                          </span>
                        </ExternalLink>
                      )}
                    </td>
                    <td className="wt-reason">{w.reason}</td>
                    <td className="wt-time muted">{w.lastCommitAt ? timeAgo(w.lastCommitAt) : ''}</td>
                    <td className="wt-action">
                      {(w.verdict === 'safe' || w.verdict === 'active') && (
                        <button className="btn btn-small" disabled={!!busy} onClick={() => setConfirm({ kind: 'one', w })}>
                          Remove…
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

      {confirm && <ConfirmRemove confirm={confirm} onCancel={() => setConfirm(null)} onConfirm={remove} />}
    </div>
  )
}

function ConfirmRemove({
  confirm,
  onCancel,
  onConfirm
}: {
  confirm: Confirm
  onCancel: () => void
  onConfirm: (targets: WorktreeInfo[], deleteBranches: boolean) => void
}) {
  const targets = confirm.kind === 'one' ? [confirm.w] : confirm.list
  // Only branches whose PR is merged or closed (every commit in it); others are always kept.
  const finished = targets.filter((w) => w.verdict === 'safe' && w.branch && (w.pr?.state === 'MERGED' || w.pr?.state === 'CLOSED'))
  const [deleteBranches, setDeleteBranches] = useState(false)
  const withIgnored = targets.filter((w) => w.notableIgnored.length)
  const ignoredNames = [...new Set(withIgnored.flatMap((w) => w.notableIgnored))]
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal modal-wide" role="alertdialog" aria-label="Remove worktrees" onMouseDown={(e) => e.stopPropagation()}>
        <h1>
          {confirm.kind === 'one'
            ? `Remove ${confirm.w.label}?`
            : `Remove ${targets.length} worktree${targets.length === 1 ? '' : 's'}?`}
        </h1>
        <p>
          {confirm.kind === 'one'
            ? `${confirm.w.reason}. `
            : 'Each has a merged or closed PR, or no commits of its own, and nothing uncommitted or unpushed. '}
          The folders are deleted with <code>git worktree remove</code>, which refuses anything with changes.
        </p>
        {finished.length > 0 && (
          <label className="check-row">
            <input type="checkbox" checked={deleteBranches} onChange={(e) => setDeleteBranches(e.target.checked)} />
            Also delete {finished.length === targets.length ? (targets.length === 1 ? 'its' : 'their') : `the ${finished.length}`} local
            branch{finished.length === 1 ? '' : 'es'} whose PR is merged or closed (GitHub&rsquo;s are untouched)
          </label>
        )}
        {confirm.kind === 'one' && confirm.w.verdict === 'active' && (
          <p className="warn">Its PR or branch is still active upstream. Everything is pushed, so you can add it back later.</p>
        )}
        {ignoredNames.length > 0 && (
          <div className="warn">
            Also deletes ignored files {confirm.kind === 'bulk' ? `in ${withIgnored.length} of them` : ''} that aren't build
            output: <code>{ignoredNames.slice(0, 8).join('  ')}</code>
            {ignoredNames.length > 8 ? ` and ${ignoredNames.length - 8} more` : ''}.
          </div>
        )}
        {confirm.kind === 'bulk' && (
          <ul className="wt-confirm-list">
            {targets.map((w) => (
              <li key={w.path}>
                {w.label} <span className="muted">· {w.reason}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => onConfirm(targets, deleteBranches)}>
            Remove{confirm.kind === 'bulk' ? ` ${targets.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
