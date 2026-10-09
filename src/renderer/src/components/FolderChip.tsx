import { useEffect, useState } from 'react'
import { errorMessage, folderName } from '../format'
import { PopupMenu, type MenuEntry } from './PopupMenu'

/**
 * The folder in the title bar: click for the places to open it, as in the
 * Claude desktop app's Open in menu. The main process resolves the folder from
 * the session, never from a path sent here.
 */
export function FolderChip({
  path,
  sessionId,
  notify
}: {
  path: string
  /** Null for a new chat (the project folder). */
  sessionId: string | null
  notify: (text: string, kind?: 'info' | 'error') => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [editors, setEditors] = useState<string[]>([])
  useEffect(() => {
    void window.desk.folderApps().then(setEditors)
  }, [])

  const open = (how: string) =>
    window.desk.openFolder(sessionId, how).catch((e) => notify(errorMessage(e), 'error'))
  const entries: MenuEntry[] = [
    { label: 'Open in Finder', onSelect: () => open('finder') },
    { label: 'Open in Terminal', onSelect: () => open('terminal') },
    ...editors.map((name): MenuEntry => ({ label: `Open in ${name}`, onSelect: () => open(name) })),
    'divider',
    {
      label: 'Copy path',
      onSelect: () =>
        navigator.clipboard.writeText(path).then(
          () => notify('Path copied'),
          (e) => notify(errorMessage(e), 'error')
        )
    }
  ]
  return (
    <>
      <button className="folder-chip folder-chip-button" title={path} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        {folderName(path)}
      </button>
      {anchor && <PopupMenu anchor={anchor} entries={entries} onClose={() => setAnchor(null)} />}
    </>
  )
}
