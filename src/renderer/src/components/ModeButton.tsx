import { useState } from 'react'
import type { PermissionMode } from '../../../shared/types'
import { PopupMenu, type MenuEntry } from './PopupMenu'

/** As the Claude desktop app names and describes them. */
export const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Claude handles permission decisions' },
  { id: 'manual', label: 'Manual', hint: 'Always ask before making changes' },
  { id: 'acceptEdits', label: 'Accept edits', hint: 'Automatically accept all file edits' },
  { id: 'plan', label: 'Plan', hint: 'Create a plan before making changes' },
  { id: 'bypassPermissions', label: 'Bypass permissions', hint: 'Accepts all permissions' }
]
export const modeLabel = (m: PermissionMode | null) => (m ? (MODES.find((x) => x.id === m)?.label ?? m) : 'Mode')

/**
 * The permission mode at the left of the footer, as in the Claude desktop app.
 * Auto, Manual, Accept edits and Plan switch live (Shift+Tab, as in the
 * terminal); Bypass permissions restarts the session in it, after a warning.
 * Session only: nothing is saved as a default.
 */
export function ModeButton({
  mode,
  blocked,
  onChoose
}: {
  /** What the terminal shows; null until it has drawn its footer. */
  mode: PermissionMode | null
  /** Why it can't switch now (a question or permission prompt open, open elsewhere, not running). */
  blocked: string | null
  onChoose: (mode: PermissionMode) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [confirmBypass, setConfirmBypass] = useState(false)
  const entries: MenuEntry[] = [
    { heading: 'Mode' },
    ...MODES.map(
      (m): MenuEntry => ({
        label: m.label,
        hint: m.hint,
        checked: mode === m.id,
        disabled: blocked ? ' ' : false,
        onSelect: () => (m.id === 'bypassPermissions' ? setConfirmBypass(true) : onChoose(m.id))
      })
    ),
    ...(blocked ? ['divider' as const, { heading: blocked }] : [])
  ]
  return (
    <>
      <button className="model-button mode-button" title={blocked ?? 'Permission mode for this session'} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        {modeLabel(mode)}
        <span className="model-caret">⌄</span>
      </button>
      {anchor && <PopupMenu anchor={anchor} entries={entries} onClose={() => setAnchor(null)} />}
      {confirmBypass && (
        <div className="modal-backdrop" onMouseDown={() => setConfirmBypass(false)}>
          <div className="modal" role="alertdialog" aria-label="Bypass permissions" onMouseDown={(e) => e.stopPropagation()}>
            <h1>Bypass permissions for this session?</h1>
            <p>
              Claude will run every command and edit without asking, including ones that can&rsquo;t be undone. The session restarts
              in this mode (the conversation continues); other sessions and your defaults are unchanged. Pick another mode to leave it.
            </p>
            <div className="modal-actions">
              <button className="btn" autoFocus onClick={() => setConfirmBypass(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  setConfirmBypass(false)
                  onChoose('bypassPermissions')
                }}
              >
                Bypass permissions
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
