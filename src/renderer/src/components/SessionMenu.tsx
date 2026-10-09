import { useEffect, useRef, useState } from 'react'
import type { SessionGroup, SessionSummary } from '../../../shared/types'
import { errorMessage } from '../format'
import { coreSessionEntries, type SessionActionHandlers } from '../sessionActions'
import { ChevronIcon } from './icons'
import { PopupMenu, type MenuEntry } from './PopupMenu'

interface Props {
  session: SessionSummary
  groups: SessionGroup[]
  runningHere: boolean
  onStop: () => void
  onRename: (s: SessionSummary, name: string) => Promise<void>
  requestDelete: SessionActionHandlers['requestDelete']
  notify: SessionActionHandlers['notify']
}

/** Session title in the top bar with a dropdown of session actions, as in the native app. */
export function SessionMenu({ session, groups, runningHere, onStop, onRename, requestDelete, notify }: Props) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setOpen(false)
    setRenaming(false)
  }, [session.id])

  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => notify(done),
      (e) => notify(errorMessage(e), 'error')
    )
  const run = (fn: () => Promise<unknown>) => fn().catch((e) => notify(errorMessage(e), 'error'))

  const core = coreSessionEntries(session, groups, runningHere, {
    startRename: () => setRenaming(true),
    requestDelete,
    notify
  })
  const elsewhere = session.liveElsewhere?.entrypoint
  const resumeCommand = `cd '${session.startCwd.replace(/'/g, `'\\''`)}' && claude --resume ${session.id}`

  const entries: MenuEntry[] = [
    core.pin,
    core.rename,
    core.move,
    ...(runningHere ? [{ label: 'Stop session', onSelect: onStop }] : []),
    'divider',
    {
      label: 'Open in Terminal',
      onSelect: () => run(() => window.desk.openInTerminal(session.id)),
      disabled: runningHere ? 'Running here' : elsewhere ? `Open in ${elsewhere}` : false
    },
    { label: 'Copy resume command', onSelect: () => copy(resumeCommand, 'Resume command copied') },
    { label: 'Copy session ID', onSelect: () => copy(session.id, 'Session ID copied') },
    { label: 'Show transcript in Finder', onSelect: () => run(() => window.desk.revealTranscript(session.id)) },
    'divider',
    core.archive,
    core.del
  ]

  if (renaming) {
    return (
      <RenameField
        className="title-rename"
        initial={session.titleSource === 'custom' || session.titleSource === 'ai' ? session.title : ''}
        onCancel={() => setRenaming(false)}
        onSubmit={async (name) => {
          await onRename(session, name)
          setRenaming(false)
        }}
      />
    )
  }

  return (
    <div className="title-menu">
      <button
        ref={button}
        className={`title-button ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="topbar-title">{session.title}</span>
        <ChevronIcon />
      </button>
      {open && button.current && <PopupMenu anchor={button.current} entries={entries} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Inline name editor: Enter saves, Escape or clicking away cancels. */
export function RenameField({
  initial,
  className,
  onSubmit,
  onCancel
}: {
  initial: string
  className: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault()
        const name = draft.trim()
        if (!name || name === initial) return onCancel()
        setBusy(true)
        try {
          await onSubmit(name)
        } finally {
          setBusy(false)
        }
      }}
    >
      <input
        autoFocus
        value={draft}
        disabled={busy}
        placeholder="Session name"
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onBlur={() => !busy && onCancel()}
        onClick={(e) => e.stopPropagation()}
      />
    </form>
  )
}
