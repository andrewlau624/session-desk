import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { NerfguardAction, NerfguardStatus } from '../../../shared/types'
import { errorMessage } from '../format'
import { themeFromCss } from './Terminal'

export const NERFGUARD_TITLES: Record<NerfguardAction, string> = {
  enable: 'Turning NerfGuard on',
  disable: 'Turning NerfGuard off',
  login: 'Signing in to NerfGuard',
  logout: 'Signing out of NerfGuard',
  dash: 'NerfGuard dashboard',
  logs: 'NerfGuard live logs'
}

/**
 * Whether sessions can switch route now: after turning on, only once its
 * gateway answers (a session restarted before that can't connect); after
 * turning off, straight away. Null for commands that don't change the route.
 */
export function routeReady(action: NerfguardAction, code: number | null, after: NerfguardStatus | null): boolean | null {
  if (action !== 'enable' && action !== 'disable') return null
  if (code !== 0 || !after) return false
  return action === 'enable' ? after.enabled && after.gateway === 'running' : !after.enabled
}

interface Props {
  action: NerfguardAction
  /** Sessions running here: idle ones can restart onto the new route; busy ones are left alone. */
  open: { idle: number; busy: number }
  onRestartIdle: () => Promise<number>
  onClose: () => void
}

/**
 * Runs one NerfGuard command in a terminal you can type into: sign-in asks
 * for your email, a code and a password, and enable can ask questions too.
 */
export function NerfguardPanel({ action, open, onRestartIdle, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [code, setCode] = useState<number | null>(null)
  const [after, setAfter] = useState<NerfguardStatus | null>(null)
  const [restarted, setRestarted] = useState<number | null>(null)

  useEffect(() => {
    const xterm = new XTerm({
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      macOptionIsMeta: true,
      scrollback: 5000,
      theme: themeFromCss()
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.open(host.current!)
    try {
      fit.fit()
    } catch {
      // Not laid out yet; the default size will do.
    }
    const offData = window.desk.onToolData((d) => xterm.write(d))
    const offExit = window.desk.onToolExit((exit) => {
      xterm.write(`\r\n\x1b[2m[nerfguard exited with code ${exit}]\x1b[0m\r\n`)
      setCode(exit)
      // The shield re-reads too.
      window.dispatchEvent(new Event('nerfguard:changed'))
      window.desk.nerfguardStatus(true).then(setAfter, () => {})
    })
    const input = xterm.onData((d) => window.desk.toolWrite(d))
    const resize = xterm.onResize(({ cols, rows }) => window.desk.toolResize(cols, rows))
    window.desk.nerfguardRun(action, xterm.cols, xterm.rows).catch((e) => {
      xterm.write(`\x1b[31m${errorMessage(e)}\x1b[0m\r\n`)
      setCode(-1)
    })
    xterm.focus()
    return () => {
      offData()
      offExit()
      input.dispose()
      resize.dispose()
      xterm.dispose()
    }
    // One panel runs one command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const running = code === null
  const close = () => {
    if (running) window.desk.toolStop()
    onClose()
  }
  const ready = routeReady(action, code, after)
  const anyOpen = open.idle + open.busy > 0

  return (
    <div className="modal-backdrop">
      <div className="modal nerfguard-panel" role="dialog" aria-label={NERFGUARD_TITLES[action]}>
        <h1>{NERFGUARD_TITLES[action]}</h1>
        {/* The frame carries the border and padding; the fit addon measures the host, so it must have none. */}
        <div className="nerfguard-term">
          <div className="nerfguard-term-host" ref={host} />
        </div>
        {ready !== null && code === 0 && anyOpen && (
          <p className="setting-hint">
            {!after
              ? 'Checking NerfGuard…'
              : !ready
                ? 'NerfGuard’s gateway isn’t answering yet. Sessions open here keep their old route; restart them once the shield turns green.'
                : restarted !== null
                  ? `Restarted ${restarted} session${restarted === 1 ? '' : 's'}${open.busy ? `; ${open.busy} busy one${open.busy === 1 ? ' was' : 's were'} left as ${open.busy === 1 ? 'it was' : 'they were'}` : ''}.`
                  : `Sessions open here keep their old route until they restart.${open.busy ? ` ${open.busy} ${open.busy === 1 ? 'is' : 'are'} busy and would be left alone.` : ''}`}
          </p>
        )}
        <div className="modal-actions">
          {ready && anyOpen && restarted === null && open.idle > 0 && (
            <button className="btn" onClick={() => void onRestartIdle().then(setRestarted)}>
              Restart {open.idle} idle session{open.idle === 1 ? '' : 's'}
            </button>
          )}
          <button className={`btn ${running ? '' : 'btn-primary'}`} onClick={close}>
            {running ? 'Stop' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
