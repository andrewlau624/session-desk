import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BranchInfo, BranchVerdict, RemoteLeftover } from '../../../shared/types'
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
type Where = 'local' | 'github'

/** The GitHub leftover for a local branch: same repo, and the branch it tracks (or its own name). */
const leftoverFor = (b: BranchInfo, leftovers: RemoteLeftover[] | null) =>
  leftovers?.find((l) => l.repo === b.repo && l.branch === (b.upstream ?? b.branch))

/**
 * Local branches of every repo in the project, with their ticket, PR and
 * sessions, and cleanup of the ones nothing would be lost from. Only branches
 * on this Mac are deleted; GitHub's are left as they are.
 */
export function Branches({ actionsTarget, notify, onOpenSession }: Props) {
  const [where, setWhere] = useState<Where>('local')
  const [list, setList] = useState<BranchInfo[] | null>(null)
  const [leftovers, setLeftovers] = useState<RemoteLeftover[] | null>(null)
  const [remoteConfirm, setRemoteConfirm] = useState<RemoteLeftover[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // GitHub's list loads alongside; the local one doesn't wait for it.
      const remote = window.desk
        .listRemoteLeftovers()
        .then(setLeftovers)
        .catch((e) => notify(`GitHub branches: ${errorMessage(e)}`, 'error'))
      setList(await window.desk.listBranches())
      await remote
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

  const remove = async (targets: BranchInfo[], alsoOnGitHub: boolean) => {
    setConfirm(null)
    const failed: string[] = []
    const removed = new Set<string>()
    const remoteGone = new Set<string>()
    for (const [i, b] of targets.entries()) {
      setBusy(`Deleting ${i + 1} of ${targets.length}: ${b.branch}`)
      try {
        await window.desk.removeBranch(b.repoPath, b.branch)
        removed.add(`${b.repoPath}\0${b.branch}`)
        const l = leftoverFor(b, leftovers)
        if (alsoOnGitHub && l?.eligible) {
          await window.desk.deleteRemoteBranch(l.slug, l.branch)
          remoteGone.add(`${l.slug}\0${l.branch}`)
        }
      } catch (e) {
        failed.push(`${b.branch}: ${errorMessage(e)}`)
      }
    }
    setBusy(null)
    setList((l) => l?.filter((b) => !removed.has(`${b.repoPath}\0${b.branch}`)) ?? l)
    setLeftovers((ls) => ls?.filter((l) => !remoteGone.has(`${l.slug}\0${l.branch}`)) ?? ls)
    const what = `Deleted ${removed.size} local branch${removed.size === 1 ? '' : 'es'}${alsoOnGitHub ? ` and ${remoteGone.size} on GitHub` : "; GitHub's are untouched"}`
    if (failed.length) notify(`${what}; ${failed.length} refused. ${failed[0]}`, 'error')
    else notify(what)
  }

  const removeRemote = async (targets: RemoteLeftover[]) => {
    setRemoteConfirm(null)
    const failed: string[] = []
    const gone = new Set<string>()
    for (const [i, l] of targets.entries()) {
      setBusy(`Deleting on GitHub ${i + 1} of ${targets.length}: ${l.branch}`)
      try {
        await window.desk.deleteRemoteBranch(l.slug, l.branch)
        gone.add(`${l.slug}\0${l.branch}`)
      } catch (e) {
        failed.push(`${l.branch}: ${errorMessage(e)}`)
      }
    }
    setBusy(null)
    setLeftovers((ls) => ls?.filter((l) => !gone.has(`${l.slug}\0${l.branch}`)) ?? ls)
    const what = `Deleted ${gone.size} branch${gone.size === 1 ? '' : 'es'} on GitHub`
    if (failed.length) notify(`${what}; ${failed.length} refused. ${failed[0]}`, 'error')
    else notify(what)
  }

  const eligibleRemote = (leftovers ?? []).filter((l) => l.eligible)

  return (
    <div className="worktrees-view">
      {actionsTarget &&
        createPortal(
          <>
            {where === 'local' && list && (
              <span className="topbar-meta">
                {list.length} branches · {counts.safe} safe to delete
              </span>
            )}
            {where === 'github' && leftovers && (
              <span className="topbar-meta">
                {leftovers.length} left on GitHub · {eligibleRemote.length} safe to delete
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
            {where === 'local' ? (
              <button
                className="btn btn-small btn-primary"
                disabled={!safe.length || loading || !!busy}
                onClick={() => setConfirm({ kind: 'bulk', list: safe })}
              >
                Delete {safe.length} safe…
              </button>
            ) : (
              <button
                className="btn btn-small btn-primary"
                disabled={!eligibleRemote.length || loading || !!busy}
                onClick={() => setRemoteConfirm(eligibleRemote)}
              >
                Delete {eligibleRemote.length} from GitHub…
              </button>
            )}
          </>,
          actionsTarget
        )}

      <div className="filter-row">
        <button className={`filter-chip ${where === 'local' ? 'on' : ''}`} onClick={() => setWhere('local')}>
          On this Mac
          {list && <span className="count">{list.length}</span>}
        </button>
        <button
          className={`filter-chip ${where === 'github' ? 'on' : ''}`}
          onClick={() => setWhere('github')}
          title="Branches of your merged PRs that are still on GitHub"
        >
          Left on GitHub
          {leftovers && <span className="count">{leftovers.length}</span>}
        </button>
      </div>

      {where === 'github' && (
        <RemoteList leftovers={leftovers} busy={busy} onDelete={(l) => setRemoteConfirm([l])} />
      )}

      {where === 'local' && <><div className="filter-row">
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

      </>}

      {confirm && (
        <ConfirmDelete
          confirm={confirm}
          remoteFor={(b) => {
            const l = leftoverFor(b, leftovers)
            return l?.eligible && b.pr?.state === 'MERGED' ? l : undefined
          }}
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
        />
      )}
      {remoteConfirm && <ConfirmRemote list={remoteConfirm} onCancel={() => setRemoteConfirm(null)} onConfirm={removeRemote} />}
    </div>
  )
}

/** Branches of your merged PRs still on GitHub. */
function RemoteList({
  leftovers,
  busy,
  onDelete
}: {
  leftovers: RemoteLeftover[] | null
  busy: string | null
  onDelete: (l: RemoteLeftover) => void
}) {
  const byRepo = useMemo(() => {
    const groups = new Map<string, RemoteLeftover[]>()
    for (const l of leftovers ?? []) groups.set(l.repo, [...(groups.get(l.repo) ?? []), l])
    for (const items of groups.values()) items.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.pr.mergedAt.localeCompare(a.pr.mergedAt))
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [leftovers])
  if (!leftovers) return <p className="muted wt-empty">Asking GitHub for your merged PRs whose branch is still there…</p>
  if (!leftovers.length) return <p className="muted wt-empty">None: every branch of your merged PRs is already gone from GitHub.</p>
  return (
    <div className="wt-scroll">
      {byRepo.map(([repo, items]) => (
        <section key={repo} className="wt-repo">
          <h2>
            {repo} <span className="count">{items.length}</span>
          </h2>
          <table className="wt-table">
            <tbody>
              {items.map((l) => (
                <tr key={l.branch} className={l.eligible ? 'wt-safe' : 'wt-blocked'}>
                  <td className="wt-verdict">
                    <span className={`wt-dot wt-dot-${l.eligible ? 'safe' : 'blocked'}`} />
                  </td>
                  <td className="wt-path" title={l.sha}>
                    {l.branch}
                    <div className="wt-branch">{l.local ? 'also on this Mac' : 'only on GitHub'}</div>
                  </td>
                  <td className="wt-links">
                    <ExternalLink href={l.pr.url}>
                      #{l.pr.number}
                      <span className="pr-badge pr-merged">Merged</span>
                    </ExternalLink>
                  </td>
                  <td className="wt-reason">{l.reason}</td>
                  <td className="wt-time muted">{timeAgo(Date.parse(l.pr.mergedAt))}</td>
                  <td className="wt-action">
                    {l.eligible && (
                      <button className="btn btn-small" disabled={!!busy} onClick={() => onDelete(l)}>
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
  )
}

function ConfirmRemote({
  list,
  onCancel,
  onConfirm
}: {
  list: RemoteLeftover[]
  onCancel: () => void
  onConfirm: (targets: RemoteLeftover[]) => void
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal modal-wide" role="alertdialog" aria-label="Delete branches on GitHub" onMouseDown={(e) => e.stopPropagation()}>
        <h1>
          Delete {list.length === 1 ? list[0].branch : `${list.length} branches`} on GitHub?
        </h1>
        <p>
          Each is the branch of one of your merged PRs and still points at that PR&rsquo;s final commit, so nothing is lost; no
          open PR builds on it. Each is re-checked on GitHub right before it&rsquo;s deleted. To bring one back, use{' '}
          <strong>Restore branch</strong> on its PR.
        </p>
        <ul className="wt-confirm-list">
          {list.map((l) => (
            <li key={`${l.slug}:${l.branch}`}>
              {l.repo} · {l.branch} <span className="muted">· PR #{l.pr.number}</span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="btn" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => onConfirm(list)}>
            Delete {list.length} on GitHub
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDelete({
  confirm,
  remoteFor,
  onCancel,
  onConfirm
}: {
  confirm: Confirm
  /** Its GitHub branch, when that too can go without losing anything. */
  remoteFor: (b: BranchInfo) => RemoteLeftover | undefined
  onCancel: () => void
  onConfirm: (targets: BranchInfo[], alsoOnGitHub: boolean) => void
}) {
  const targets = confirm.kind === 'one' ? [confirm.b] : confirm.list
  const onGitHub = targets.filter((b) => remoteFor(b))
  const [alsoOnGitHub, setAlsoOnGitHub] = useState(false)
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
          {alsoOnGitHub ? 'Branches on this Mac are deleted, and the ticked ones on GitHub too.' : 'Only the branches on this Mac are deleted; GitHub\u2019s are left as they are.'} Each is re-checked first, and git keeps
          the commits for about 90 days, so a deleted branch can be brought back from its last commit.
        </p>
        {onGitHub.length > 0 && (
          <label className="check-row">
            <input type="checkbox" checked={alsoOnGitHub} onChange={(e) => setAlsoOnGitHub(e.target.checked)} />
            Also delete {onGitHub.length === targets.length ? (targets.length === 1 ? 'it' : 'them') : `the ${onGitHub.length}`} on GitHub
            (your merged PRs whose branch still points at the PR&rsquo;s final commit; Restore branch on the PR brings one back)
          </label>
        )}
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
          <button className="btn btn-danger" onClick={() => onConfirm(targets, alsoOnGitHub)}>
            Delete{confirm.kind === 'bulk' ? ` ${targets.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
