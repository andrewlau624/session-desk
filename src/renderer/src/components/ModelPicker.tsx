import { useState } from 'react'
import { EFFORT_CHOICES, MODEL_CHOICES, type SessionLaunch, type SessionSummary } from '../../../shared/types'
import { modelLabel } from '../format'
import { PopupMenu, type MenuEntry } from './PopupMenu'

const aliasLabel = (alias: string) => MODEL_CHOICES.find((m) => m.alias === alias)?.label ?? alias
const effortLabel = (level: string) => EFFORT_CHOICES.find((e) => e.level === level)?.label ?? level

/**
 * What the session runs on: its latest reply's model and effort, or the
 * choice made here until a reply reflects it. Null parts are unknown (a new
 * chat before its first reply runs on your defaults).
 */
export function currentChoice(
  session: Pick<SessionSummary, 'model' | 'effort' | 'lastActivity'> | null,
  launch: SessionLaunch | null
): { model: string | null; effort: string | null; alias: string | null } {
  // A reply newer than the choice shows what actually ran (it also catches /model typed in the terminal).
  const replied = !!session && !!launch && session.lastActivity > launch.at
  const model =
    launch?.model && !(replied && session?.model) ? aliasLabel(launch.model) : session?.model ? modelLabel(session.model) : null
  const effort = launch?.effort && !(replied && session?.effort) ? launch.effort : (session?.effort ?? null)
  // Which menu row is current: the choice, else the reply's family (no way to tell 1M from it).
  const family = session?.model ? /^claude-([a-z]+)/.exec(session.model)?.[1] ?? null : null
  const alias = launch?.model && !(replied && session?.model) ? launch.model : family
  return { model, effort, alias }
}

/**
 * The model and effort button under the terminal, as in the Claude desktop
 * app. A choice applies to this session only: the app restarts its Claude with
 * --model/--effort, so your defaults for new sessions never change.
 */
export function ModelPicker({
  session,
  launch,
  blocked,
  onChoose
}: {
  session: SessionSummary | null
  launch: SessionLaunch | null
  /** Why it can't change right now (Claude working, a dialog open, open in another app). */
  blocked: string | null
  onChoose: (choice: { model?: string; effort?: string }) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { model, effort, alias } = currentChoice(session, launch)
  const currentEffort = effort
  const entries: MenuEntry[] = [
    { heading: 'Model' },
    ...MODEL_CHOICES.map(
      (m): MenuEntry => ({
        label: m.label,
        checked: alias === m.alias,
        disabled: blocked ? ' ' : false,
        onSelect: () => onChoose({ model: m.alias })
      })
    ),
    'divider',
    { heading: 'Effort' },
    ...EFFORT_CHOICES.map(
      (e): MenuEntry => ({
        label: e.label,
        checked: currentEffort === e.level,
        disabled: blocked ? ' ' : false,
        onSelect: () => onChoose({ effort: e.level })
      })
    ),
    'divider',
    { heading: blocked ?? 'For this session only; restarts it' }
  ]
  return (
    <>
      <button
        className="model-button"
        title={blocked ?? 'Model and effort for this session'}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {model ?? 'Default model'}
        {currentEffort && <span className="muted"> · {effortLabel(currentEffort)}</span>}
        <span className="model-caret">⌄</span>
      </button>
      {anchor && <PopupMenu anchor={anchor} entries={entries} onClose={() => setAnchor(null)} />}
    </>
  )
}
