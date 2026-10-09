import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HookStatus } from '../../../shared/types'
import { errorMessage, shortPath } from '../format'

const STATE_TEXT: Record<HookStatus['state'], string> = {
  installed: 'Installed',
  outdated: 'Installed, but the hook script is older than this app’s',
  partial: 'Partly installed (missing or changed entries)',
  missing: 'Not installed'
}

/**
 * The Claude Code hook that reports working / waiting. Installing shows the
 * exact settings.json change first; the file is backed up before writing.
 */
export function HookSection({ notify }: { notify: (text: string, kind?: 'info' | 'error') => void }) {
  const [status, setStatus] = useState<HookStatus | null>(null)
  const [preview, setPreview] = useState<{ action: 'install' | 'uninstall'; diff: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.desk.hookStatus().then(setStatus, (e) => notify(errorMessage(e), 'error'))
  }, [notify])

  const open = async (action: 'install' | 'uninstall') => {
    try {
      setPreview({ action, diff: await window.desk.hookPreview(action) })
    } catch (e) {
      notify(errorMessage(e), 'error')
    }
  }

  const apply = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const next = await window.desk.hookApply(preview.action)
      setStatus(next)
      notify(preview.action === 'install' ? 'Status hook installed. Running sessions pick it up on their next turn.' : 'Status hook removed.')
      setPreview(null)
    } catch (e) {
      notify(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  return (
    <section className="setting">
      <div className="setting-label">Waiting status hook</div>
      <div className={`setting-value-plain ${status.state === 'installed' ? '' : 'warn-text'}`}>{STATE_TEXT[status.state]}</div>
      <p className="setting-hint">
        A Claude Code hook in <code>{shortPath(status.settingsPath)}</code> that tells Session Desk when a session is working or
        waiting for you, in this app, Claude desktop or a terminal. Waiting Response, the sidebar status and notifications need it.
      </p>
      <div className="setting-actions">
        {status.state !== 'installed' && (
          <button className="btn btn-small btn-primary" onClick={() => open('install')}>
            {status.state === 'missing' ? 'Install…' : 'Update…'}
          </button>
        )}
        {status.state !== 'missing' && (
          <button className="btn btn-small" onClick={() => open('uninstall')}>
            Uninstall…
          </button>
        )}
      </div>

      {preview &&
        createPortal(
          <div className="modal-backdrop" onMouseDown={() => setPreview(null)}>
            <div className="modal modal-wide" role="alertdialog" aria-label="Hook change" onMouseDown={(e) => e.stopPropagation()}>
              <h1>{preview.action === 'install' ? 'Install the status hook?' : 'Remove the status hook?'}</h1>
              <p>
                {preview.action === 'install'
                  ? 'Adds Session Desk’s entries to your Claude Code settings, leaving your other hooks and settings as they are, and copies the hook script to ~/.session-desk/hook.sh. It prints nothing and always exits 0, so Claude is unaffected.'
                  : 'Removes only Session Desk’s entries; your other hooks and settings stay.'}{' '}
                {shortPath(status.settingsPath)} is backed up first.
              </p>
              {preview.diff ? (
                <pre className="diff">{preview.diff}</pre>
              ) : (
                <p className="muted">No change to settings.json is needed{preview.action === 'install' ? '; the hook script will be refreshed.' : '.'}</p>
              )}
              <div className="modal-actions">
                <button className="btn" autoFocus onClick={() => setPreview(null)}>
                  Cancel
                </button>
                <button className={`btn ${preview.action === 'install' ? 'btn-primary' : 'btn-danger'}`} disabled={busy} onClick={apply}>
                  {busy ? 'Applying…' : preview.action === 'install' ? 'Back up and install' : 'Back up and remove'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </section>
  )
}
