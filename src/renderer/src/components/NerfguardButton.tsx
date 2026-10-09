import { useEffect, useState } from 'react'
import type { NerfguardStatus } from '../../../shared/types'
import { errorMessage } from '../format'
import { PopupMenu, type MenuEntry } from './PopupMenu'

const SITE = 'https://nerfguard.com'
// A status check is cheap for the app but starts NerfGuard's CLI: every few minutes, and on focus.
const POLL_MS = 5 * 60_000

type Look = 'missing' | 'off' | 'on' | 'warn'

/** How the icon looks, and what its tooltip says. */
export function nerfguardLook(s: NerfguardStatus | null): { look: Look; title: string } {
  if (!s) return { look: 'off', title: 'NerfGuard: checking…' }
  if (!s.installed) return { look: 'missing', title: 'NerfGuard isn’t installed' }
  if (s.error) return { look: 'warn', title: s.error }
  if (!s.enabled) return { look: 'off', title: 'NerfGuard is off: Claude Code connects directly' }
  if (s.gateway !== 'running') return { look: 'warn', title: 'NerfGuard is on, but its gateway isn’t running' }
  if (s.signIn === 'expired' || s.signIn === 'signed-out') return { look: 'warn', title: 'NerfGuard is on, but you’re signed out' }
  return { look: 'on', title: 'NerfGuard is on: Claude Code goes through it' }
}

/** The menu's status lines: routing, then sign-in. */
export function nerfguardSummary(s: NerfguardStatus): string[] {
  if (!s.installed) return ['Not installed']
  if (s.error) return [s.error]
  const routing = !s.enabled
    ? 'Off: Claude Code connects directly'
    : s.gateway === 'running'
      ? 'On: Claude Code goes through it'
      : 'On, but its gateway isn’t running'
  const signIn =
    s.signIn === 'signed-in'
      ? `Signed in${s.email ? ` as ${s.email}` : ''}`
      : s.signIn === 'expired'
        ? `Sign-in expired${s.email ? ` (${s.email})` : ''}`
        : s.signIn === 'signed-out'
          ? 'Not signed in'
          : null
  return signIn ? [routing, signIn] : [routing]
}

interface Props {
  notify: (text: string, kind?: 'info' | 'error') => void
}

/**
 * NerfGuard in the sidebar toolbar (app-wide, unlike the session's top bar): whether Claude Code (and so every session here)
 * is routed through it. Shown while it isn't installed too, unless Settings
 * hides it.
 */
export function NerfguardButton({ notify }: Props) {
  const [status, setStatus] = useState<NerfguardStatus | null>(null)
  const [hidden, setHidden] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const load = (force = false) =>
    window.desk
      .nerfguardStatus(force)
      .then(setStatus)
      .catch((e) => notify(errorMessage(e), 'error'))

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    const readPref = () => void window.desk.getSettings().then((s) => setHidden(s.hideNerfguardWhenMissing))
    readPref()
    const off = window.desk.onSettingsChanged(readPref)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (hidden && status && !status.installed) return null
  const { look, title } = nerfguardLook(status)
  const entries: MenuEntry[] = [
    { heading: `NerfGuard${status?.version ? ` ${status.version}` : ''}` },
    ...(status ? nerfguardSummary(status).map((line): MenuEntry => ({ heading: line })) : []),
    'divider',
    ...(status?.installed
      ? [{ label: 'Check again', onSelect: () => void load(true) }]
      : [
          {
            label: 'Hide until it’s installed',
            title: 'Settings can show it again',
            onSelect: () => void window.desk.setHideNerfguard(true).catch((e) => notify(errorMessage(e), 'error'))
          }
        ]),
    { label: 'About NerfGuard…', onSelect: () => window.desk.openExternal(SITE) }
  ]

  return (
    <>
      <button
        className={`icon-button nerfguard-button ng-${look}`}
        title={title}
        aria-label={title}
        onClick={(e) => {
          // Re-check on open, so the menu never shows a stale state.
          if (!anchor) void load(true)
          setAnchor(anchor ? null : e.currentTarget)
        }}
      >
        <ShieldIcon look={look} />
      </button>
      {anchor && <PopupMenu anchor={anchor} entries={entries} onClose={() => setAnchor(null)} />}
    </>
  )
}

/** A shield: filled with a check when on, a slash when not installed, a dot when it needs attention. */
function ShieldIcon({ look }: { look: Look }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 1.75 13 3.5v4c0 3.1-2.1 5.6-5 6.75C5.1 13.1 3 10.6 3 7.5v-4L8 1.75Z" fill={look === 'on' ? 'currentColor' : 'none'} fillOpacity={look === 'on' ? 0.18 : 0} />
      {look === 'on' && <path d="m5.75 8 1.5 1.5 3-3" />}
      {look === 'missing' && <path d="M2.5 2.5 13.5 13.5" />}
      {look === 'warn' && <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />}
    </svg>
  )
}
