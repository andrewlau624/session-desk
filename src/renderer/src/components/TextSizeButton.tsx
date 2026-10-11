import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TERM_FONT_DEFAULT, TERM_FONT_MAX, TERM_FONT_MIN } from '../termFont'

/**
 * "Aa" in the session footer: a popover with a slider for the terminals' text
 * size. One size for every session; it changes live as you drag.
 */
export function TextSizeButton({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ bottom: number; right: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !button.current) return
    const b = button.current.getBoundingClientRect()
    setPos({ bottom: window.innerHeight - b.top + 6, right: Math.max(8, window.innerWidth - b.right) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <>
      <button
        ref={button}
        className="model-button text-size-button"
        title={`Text size: ${size}pt`}
        aria-label="Text size"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Aa
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="usage-panel text-size-panel"
            style={pos ? { bottom: pos.bottom, right: pos.right } : { visibility: 'hidden' }}
          >
            <div className="usage-section">
              <div className="usage-row">
                <span>Text size</span>
                <span className="muted">{size}pt · all sessions</span>
              </div>
              <div className="text-size-row">
                <button
                  className="icon-button text-size-step"
                  aria-label="Smaller"
                  disabled={size <= TERM_FONT_MIN}
                  onClick={() => onChange(size - 1)}
                >
                  <span style={{ fontSize: 11 }}>A</span>
                </button>
                <input
                  type="range"
                  className="text-size-slider"
                  min={TERM_FONT_MIN}
                  max={TERM_FONT_MAX}
                  step={1}
                  value={size}
                  aria-label="Text size"
                  aria-valuetext={`${size} points`}
                  onChange={(e) => onChange(Number(e.target.value))}
                  autoFocus
                />
                <button
                  className="icon-button text-size-step"
                  aria-label="Bigger"
                  disabled={size >= TERM_FONT_MAX}
                  onClick={() => onChange(size + 1)}
                >
                  <span style={{ fontSize: 16 }}>A</span>
                </button>
              </div>
              <div className="usage-row">
                <span className="muted">Default is {TERM_FONT_DEFAULT}pt</span>
                <button className="btn btn-small" disabled={size === TERM_FONT_DEFAULT} onClick={() => onChange(TERM_FONT_DEFAULT)}>
                  Reset
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
