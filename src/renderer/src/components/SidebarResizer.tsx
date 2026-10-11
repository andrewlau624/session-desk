import { useEffect, useRef, useState } from 'react'
import { clampWidth, loadWidth, saveWidth, SIDEBAR_DEFAULT } from '../sidebarWidth'

const KEY_STEP = 16

/**
 * The sidebar's width: the one you chose, narrowed while the window is too
 * small for it and back once there's room again.
 */
export function useSidebarWidth(): [number, (w: number) => void] {
  const [preferred, setPreferred] = useState(loadWidth)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return [clampWidth(preferred, windowWidth), (w) => setPreferred(clampWidth(w, window.innerWidth))]
}

/**
 * The sidebar's right edge: drag to resize, double-click for the default
 * width, or focus it and use the arrow keys. The width is saved when you let go.
 */
export function SidebarResizer({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const latest = useRef(width)
  latest.current = width

  const set = (w: number) => {
    const clamped = clampWidth(w, window.innerWidth)
    onChange(clamped)
    return clamped
  }

  return (
    <div
      className={`sidebar-resizer${dragging ? ' dragging' : ''}`}
      style={{ left: width - 3 }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { startX: e.clientX, startWidth: width }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (drag.current) set(drag.current.startWidth + e.clientX - drag.current.startX)
      }}
      onPointerUp={() => {
        if (!drag.current) return
        drag.current = null
        setDragging(false)
        saveWidth(latest.current)
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return
        drag.current = null
        setDragging(false)
        saveWidth(latest.current)
      }}
      onDoubleClick={() => saveWidth(set(SIDEBAR_DEFAULT))}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0
        if (!step) return
        e.preventDefault()
        saveWidth(set(width + step))
      }}
    />
  )
}
