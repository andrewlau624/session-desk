import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionUsage, UsageLimit } from '../../../shared/types'

const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const pct = (used: number, size: number) => Math.min(100, Math.round((used / size) * 100))

/** "Resets in 2 hr 41 min" within a day, else "Resets Sun 12:00 PM". */
export function resetLabel(at: number | null, now = Date.now()): string {
  if (!at) return ''
  const mins = Math.max(0, Math.round((at - now) / 60_000))
  if (mins < 24 * 60) return `Resets in ${mins >= 60 ? `${Math.floor(mins / 60)} hr ` : ''}${mins % 60} min`
  return `Resets ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
}

/** The context line: "847.4k / 1M (85%)", or just the tokens when the window size isn't known. */
export function contextLabel(c: NonNullable<SessionUsage['context']>): string {
  return c.size ? `${k(c.used)} / ${k(c.size)} (${pct(c.used, c.size)}%)` : `${k(c.used)} tokens`
}

function Meter({ value, tone }: { value: number; tone?: 'warn' | 'bad' }) {
  return (
    <div className="usage-meter">
      <div className={`usage-meter-fill ${tone ?? ''}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

function LimitRow({ name, limit }: { name: string; limit: UsageLimit }) {
  return (
    <div className="usage-limit">
      <div className="usage-row">
        <span>{name}</span>
        <span className="muted">
          {resetLabel(limit.resetsAt)} {limit.usedPercent}%
        </span>
      </div>
      <Meter value={limit.usedPercent} tone={limit.usedPercent >= 90 ? 'bad' : limit.usedPercent >= 75 ? 'warn' : undefined} />
    </div>
  )
}

/** A small ring showing how full the context window is (empty when unknown). */
function Ring({ value }: { value: number | null }) {
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--border)" strokeWidth="2" />
      {value !== null && (
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke={value >= 90 ? 'var(--danger, #c0392b)' : value >= 75 ? '#d4a017' : 'var(--accent)'}
          strokeWidth="2"
          strokeDasharray={`${(c * value) / 100} ${c}`}
          transform="rotate(-90 8 8)"
        />
      )}
    </svg>
  )
}

/**
 * The context window and plan usage limits, as in the Claude desktop app's
 * footer. Compact and See detailed breakdown type /compact and /usage into the
 * session when it's idle (neither changes any setting).
 */
export function UsageButton({
  sessionId,
  blocked,
  notify
}: {
  sessionId: string
  /** Why it can't take a command now (working, a dialog open, open elsewhere). */
  blocked: string | null
  notify: (text: string, kind?: 'info' | 'error') => void
}) {
  const [usage, setUsage] = useState<SessionUsage | null>(null)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ bottom: number; right: number } | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      window.desk
        .sessionUsage(sessionId)
        .then((u) => live && setUsage(u))
        .catch(() => {})
    void load()
    // The status line saves after each reply, as the transcript changes.
    const off = window.desk.onSessionsChanged(load)
    return () => {
      live = false
      off()
    }
  }, [sessionId])

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

  const c = usage?.context ?? null
  const fill = c?.size ? pct(c.used, c.size) : null
  const send = async (command: '/compact' | '/usage') => {
    setOpen(false)
    const ok = await window.desk.sessionCommand(sessionId, command).catch(() => false)
    if (!ok) notify(`Couldn't send ${command}: the session isn't open here`, 'error')
  }
  const l = usage?.limits

  return (
    <>
      <button
        ref={button}
        className="model-button usage-button"
        title={c ? `Context ${contextLabel(c)}` : 'Context and usage limits'}
        onClick={() => setOpen((o) => !o)}
      >
        <Ring value={fill} />
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="usage-panel" style={pos ? { bottom: pos.bottom, right: pos.right } : { visibility: 'hidden' }}>
            <div className="usage-section">
              <div className="usage-row">
                <span className="muted">Context window</span>
                <span className="muted">{c ? contextLabel(c) : 'Not known yet'}</span>
              </div>
              {fill !== null && <Meter value={fill} tone={fill >= 90 ? 'bad' : fill >= 75 ? 'warn' : undefined} />}
              <div className="usage-row">
                <span className="muted">
                  {c?.autoCompactAt
                    ? `About ${k(Math.max(0, c.autoCompactAt - c.used))} until auto-compact`
                    : usage?.source === 'transcript'
                      ? 'Window size shows once the app has run this session'
                      : ''}
                </span>
                <button className="btn btn-small" disabled={!!blocked} title={blocked ?? 'Send /compact to this session'} onClick={() => send('/compact')}>
                  Compact session
                </button>
              </div>
            </div>
            <div className="usage-section">
              <div className="usage-row">
                <span className="muted">Your usage limits</span>
              </div>
              {l?.fiveHour && <LimitRow name="Session limit" limit={l.fiveHour} />}
              {l?.sevenDay && <LimitRow name="Weekly · all models" limit={l.sevenDay} />}
              {!l?.fiveHour && !l?.sevenDay && <p className="muted usage-empty">Shown after a reply in a session started here.</p>}
            </div>
            <div className="usage-section">
              <button className="btn btn-small" disabled={!!blocked} title={blocked ?? 'Send /usage to this session'} onClick={() => send('/usage')}>
                See detailed breakdown
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
