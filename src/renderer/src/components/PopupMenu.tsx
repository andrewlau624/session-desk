import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MenuEntry =
  | 'divider'
  | {
      label: string
      onSelect?: () => void
      /** A reason string disables the item and is shown as its hint. */
      disabled?: string | false
      danger?: boolean
      /** Opens a nested panel in place (with a Back row) instead of selecting. */
      submenu?: MenuEntry[]
      /** Renders a text field; Enter submits it. */
      input?: { placeholder: string; onSubmit: (value: string) => void }
    }

interface Props {
  /** Element the menu opens from; it is positioned against this element's box. */
  anchor: HTMLElement
  entries: MenuEntry[]
  onClose: () => void
  align?: 'left' | 'right'
}

/**
 * A dropdown rendered into <body> with fixed positioning, so it is never
 * clipped by a scrolling container such as the session list.
 */
export function PopupMenu({ anchor, entries, onClose, align = 'left' }: Props) {
  const [stack, setStack] = useState<{ title: string; entries: MenuEntry[] }[]>([])
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const el = useRef<HTMLDivElement>(null)
  const current = stack.length ? stack[stack.length - 1].entries : entries

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect()
    const m = el.current!.getBoundingClientRect()
    let top = a.bottom + 4
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, a.top - m.height - 4)
    let left = align === 'right' ? a.right - m.width : a.left
    left = Math.min(Math.max(8, left), window.innerWidth - m.width - 8)
    setPos({ top, left })
  }, [anchor, align, stack])

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (!el.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Any scroll moves the anchor out from under a fixed-position menu.
    const scroll = (e: Event) => !el.current?.contains(e.target as Node) && onClose()
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={el}
      className="menu menu-popup"
      role="menu"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      {stack.length > 0 && (
        <>
          <button className="menu-item menu-back" onClick={() => setStack((s) => s.slice(0, -1))}>
            ‹ {stack[stack.length - 1].title}
          </button>
          <div className="menu-divider" />
        </>
      )}
      {current.map((entry, i) => {
        if (entry === 'divider') return <div key={`d${i}`} className="menu-divider" />
        if (entry.input) return <MenuInput key={`i${i}`} {...entry.input} onDone={onClose} />
        return (
          <button
            key={entry.label}
            role="menuitem"
            className={`menu-item ${entry.danger ? 'menu-danger' : ''}`}
            disabled={!!entry.disabled}
            onClick={() => {
              if (entry.submenu) setStack((s) => [...s, { title: entry.label, entries: entry.submenu! }])
              else {
                onClose()
                entry.onSelect?.()
              }
            }}
          >
            {entry.label}
            {entry.disabled ? (
              <span className="menu-hint">{entry.disabled}</span>
            ) : entry.submenu ? (
              <span className="menu-hint">›</span>
            ) : null}
          </button>
        )
      })}
    </div>,
    document.body
  )
}

function MenuInput({
  placeholder,
  onSubmit,
  onDone
}: {
  placeholder: string
  onSubmit: (value: string) => void
  onDone: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <form
      className="menu-input"
      onSubmit={(e) => {
        e.preventDefault()
        if (!value.trim()) return
        onDone()
        onSubmit(value.trim())
      }}
    >
      <input autoFocus placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
    </form>
  )
}
