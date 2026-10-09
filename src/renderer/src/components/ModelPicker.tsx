import { useEffect, useState, type MouseEvent } from 'react'
import type { CatalogModel, ModelCatalog, SessionLaunch, SessionSummary } from '../../../shared/types'
import { modelLabel } from '../format'
import { PopupMenu, type MenuEntry } from './PopupMenu'

// A 1M-context variant runs the same model: list and label it as that model.
const baseId = (id: string) => id.replace(/\[1m\]$/, '')
// Catalog IDs may carry a date (claude-haiku-4-5-20251001); transcripts may or may not.
const sameModel = (a: string, b: string) => {
  const strip = (id: string) => baseId(id).replace(/-\d{8}$/, '')
  return strip(a) === strip(b)
}

/**
 * What the session runs on: its latest reply's model and effort, or the
 * choice made here until a reply reflects it. Null parts are unknown (a new
 * chat before its first reply runs on your defaults).
 */
export function currentChoice(
  session: Pick<SessionSummary, 'model' | 'effort' | 'lastActivity'> | null,
  launch: SessionLaunch | null
): { model: string | null; modelId: string | null; effort: string | null } {
  // A reply newer than the choice shows what actually ran (it also catches /model typed in the terminal).
  const replied = !!session && !!launch && session.lastActivity > launch.at
  const modelId = launch?.model && !(replied && session?.model) ? baseId(launch.model) : session?.model ? baseId(session.model) : null
  const effort = launch?.effort && !(replied && session?.effort) ? launch.effort : (session?.effort ?? null)
  return { model: modelId ? modelLabel(modelId) : null, modelId, effort }
}

/** The model and effort menus from the catalog: the main models, then More models; the current model's efforts. */
export function pickerMenus(
  catalog: ModelCatalog,
  current: { modelId: string | null; effort: string | null },
  blocked: string | null,
  onChoose: (choice: { model?: string; effort?: string }) => void
): { models: MenuEntry[]; efforts: MenuEntry[] | null; modelName: string | null; effortName: string | null } {
  const disabled = blocked ? ' ' : false
  const option = (m: CatalogModel): MenuEntry => ({
    label: m.name,
    checked: !!current.modelId && sameModel(current.modelId, m.id),
    disabled,
    title: m.notice,
    onSelect: () => onChoose({ model: m.id })
  })
  const main = catalog.models.filter((m) => m.section === 'main')
  const more = catalog.models.filter((m) => m.section === 'overflow')
  const footnote: MenuEntry[] = ['divider', { heading: blocked ?? 'For this session only; restarts it' }]
  const models: MenuEntry[] = [...main.map(option), ...(more.length ? ['divider' as const, { label: 'More models', submenu: more.map(option) }] : []), ...footnote]
  const model = current.modelId ? catalog.models.find((m) => sameModel(current.modelId!, m.id)) : undefined
  // A model the catalog doesn't know (or a new chat on defaults): offer the levels other models share.
  const levels = model ? model.efforts : (catalog.models.find((m) => m.efforts)?.efforts ?? null)
  const efforts = levels
    ? [
        ...levels.map(
          (e): MenuEntry => ({ label: e.name, hint: e.badge, checked: current.effort === e.id, disabled, onSelect: () => onChoose({ effort: e.id }) })
        ),
        ...footnote
      ]
    : null
  const effortName = current.effort ? (levels?.find((e) => e.id === current.effort)?.name ?? current.effort) : null
  return { models, efforts, modelName: model?.name ?? (current.modelId ? modelLabel(current.modelId) : null), effortName }
}

interface Props {
  session: SessionSummary | null
  launch: SessionLaunch | null
  /** Why it can't change right now (Claude working, a dialog open, open in another app). */
  blocked: string | null
  onChoose: (choice: { model?: string; effort?: string }) => void
}

/**
 * The model and effort buttons under the terminal, as in the Claude desktop
 * app, listing what Claude Code's catalog offers this account (new models
 * appear when Claude Code next refreshes it). A choice applies to this session
 * only: the app restarts its Claude with --model/--effort, so your defaults for
 * new sessions never change.
 */
export function ModelPicker({ session, launch, blocked, onChoose }: Props) {
  const [open, setOpen] = useState<{ which: 'model' | 'effort'; anchor: HTMLElement } | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const load = () => void window.desk.modelCatalog().then(setCatalog).catch(() => {})
  useEffect(load, [])
  const current = currentChoice(session, launch)
  const menus = catalog && pickerMenus(catalog, current, blocked, onChoose)
  const toggle = (which: 'model' | 'effort') => (e: MouseEvent<HTMLButtonElement>) => {
    // Re-read on open: Claude Code refreshes its catalog about hourly.
    if (!open) load()
    setOpen(open?.which === which ? null : { which, anchor: e.currentTarget })
  }
  const entries = open?.which === 'model' ? menus?.models : menus?.efforts
  return (
    <>
      <button className="model-button" title={blocked ?? 'Model for this session'} onClick={toggle('model')}>
        {menus?.modelName ?? current.model ?? 'Default model'}
        <span className="model-caret">⌄</span>
      </button>
      {(!menus || menus.efforts) && (
        <button className="model-button" title={blocked ?? 'Effort for this session'} onClick={toggle('effort')}>
          {menus?.effortName ?? current.effort ?? 'Default effort'}
          <span className="model-caret">⌄</span>
        </button>
      )}
      {open && entries && <PopupMenu anchor={open.anchor} entries={entries} onClose={() => setOpen(null)} align="right" />}
    </>
  )
}
