import type { SessionGroup, SessionSummary } from '../../shared/types'
import type { MenuEntry } from './components/PopupMenu'
import { errorMessage } from './format'

export interface SessionActionHandlers {
  /** Starts inline rename wherever the menu was opened from. */
  startRename: () => void
  /** Asks for confirmation, then deletes. */
  requestDelete: (s: SessionSummary) => void
  notify: (text: string, kind?: 'info' | 'error') => void
}

async function attempt(fn: () => Promise<unknown>, notify: SessionActionHandlers['notify'], done?: string) {
  try {
    await fn()
    if (done) notify(done)
  } catch (e) {
    notify(errorMessage(e), 'error')
  }
}

/** "Move to group" panel: existing groups, remove-from-group, and create-and-move. */
function moveEntries(s: SessionSummary, groups: SessionGroup[], notify: SessionActionHandlers['notify']): MenuEntry[] {
  return [
    ...groups.map(
      (g): MenuEntry => ({
        label: g.name,
        disabled: s.groupId === g.id ? 'Current' : false,
        onSelect: () => attempt(() => window.desk.moveSession(s.id, g.id), notify, `Moved to ${g.name}`)
      })
    ),
    ...(groups.length ? ['divider' as const] : []),
    ...(s.groupId
      ? [
          {
            label: 'Remove from group',
            onSelect: () => attempt(() => window.desk.moveSession(s.id, null), notify, 'Removed from group')
          }
        ]
      : []),
    {
      label: 'New group',
      input: {
        placeholder: 'New group name',
        onSubmit: (name) =>
          attempt(
            async () => {
              const g = await window.desk.createGroup(name)
              await window.desk.moveSession(s.id, g.id)
            },
            notify,
            `Moved to ${name}`
          )
      }
    }
  ]
}

/** The actions both the sidebar row menu and the title-bar menu share. */
export function coreSessionEntries(
  s: SessionSummary,
  groups: SessionGroup[],
  runningHere: boolean,
  h: SessionActionHandlers
): { pin: MenuEntry; rename: MenuEntry; move: MenuEntry; archive: MenuEntry; del: MenuEntry } {
  const elsewhere = s.liveElsewhere?.entrypoint
  return {
    pin: s.pinned
      ? { label: 'Unpin', onSelect: () => attempt(() => window.desk.pinSession(s.id, false), h.notify) }
      : {
          label: 'Pin',
          onSelect: () => attempt(() => window.desk.pinSession(s.id, true), h.notify),
          disabled: s.archived ? 'Archived' : false
        },
    rename: { label: 'Rename…', onSelect: h.startRename, disabled: elsewhere ? `Open in ${elsewhere}` : false },
    move: { label: 'Move to group', submenu: moveEntries(s, groups, h.notify), disabled: s.archived ? 'Archived' : false },
    archive: s.archived
      ? {
          label: 'Unarchive',
          onSelect: () => attempt(() => window.desk.archiveSession(s.id, false), h.notify, 'Unarchived')
        }
      : { label: 'Archive', onSelect: () => attempt(() => window.desk.archiveSession(s.id, true), h.notify, 'Archived') },
    del: {
      label: 'Delete…',
      danger: true,
      onSelect: () => h.requestDelete(s),
      // Deleting a transcript a running process is still writing would leave it half-written.
      disabled: runningHere ? 'Stop it first' : elsewhere ? `Open in ${elsewhere}` : false
    }
  }
}
