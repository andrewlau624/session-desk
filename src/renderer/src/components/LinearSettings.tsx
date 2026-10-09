import { useState } from 'react'
import type { LinearStatus } from '../../../shared/types'
import { errorMessage, linearSettingsUrl } from '../format'
import { ExternalLink } from './links'

interface Props {
  status: LinearStatus
  /** The project folder's name: each project has its own connection. */
  project: string | null
  onChange: (status: LinearStatus) => void
  onClose: () => void
}

export function LinearSettings({ status, project, onChange, onClose }: Props) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (value: string | null) => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.desk.linearSetKey(value)
      onChange(next)
      if (value && !next.connected) setError(next.error ?? 'Linear did not accept that key.')
      else onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Linear connection" onMouseDown={(e) => e.stopPropagation()}>
        <h1>Linear{project ? ` for ${project}` : ''}</h1>
        {status.connected ? (
          <>
            <p>
              Connected as <strong>{status.viewer}</strong>
              {status.workspace.urlKey ? <> to the <strong>{status.workspace.urlKey}</strong> workspace</> : null}.
              {project ? ` Other projects keep their own connections.` : ''}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => submit(null)} disabled={busy}>
                Disconnect
              </button>
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (key.trim()) submit(key)
            }}
          >
            <p>
              Paste a personal API key from{' '}
              <ExternalLink href={linearSettingsUrl()}>
                Linear → Settings → Security &amp; access
              </ExternalLink>
              . It's used for this project only{project ? ` (${project})` : ''}, stored encrypted with a key held in your macOS
              Keychain, and only sent to api.linear.app.
            </p>
            <input
              type="password"
              autoFocus
              className="key-input"
              placeholder="lin_api_…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions">
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || !key.trim()}>
                {busy ? 'Checking…' : 'Connect'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
