import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Kickoff, PrBranch } from '../../../shared/types'

interface Props {
  sessionId: string
  resume: boolean
  cwd: string
  /** Display name for a new session. */
  name?: string
  /** Ticket the new session is for. */
  ticket?: string
  /** Opening turn for the ticket's work (with `ticket`). */
  kickoff?: Kickoff
  prBranch?: PrBranch
  visible: boolean
  onExit: (code: number) => void
}

export function themeFromCss(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    background: v('--term-bg'),
    foreground: v('--term-fg'),
    cursor: v('--term-fg'),
    selectionBackground: v('--term-selection')
  }
}

/**
 * One live `claude` process. Mounted once and kept mounted (hidden when not
 * active) so switching sessions never restarts or interrupts a running one.
 */
export function Terminal({ sessionId, resume, cwd, name, ticket, kickoff, prBranch, visible, onExit }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const fit = useRef<FitAddon | null>(null)
  const term = useRef<XTerm | null>(null)
  const exitRef = useRef(onExit)
  exitRef.current = onExit

  useEffect(() => {
    const xterm = new XTerm({
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollback: 10000,
      theme: themeFromCss()
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(host.current!)
    term.current = xterm
    fit.current = fitAddon
    try {
      fitAddon.fit()
    } catch {
      // Hidden on mount; fitted when shown.
    }

    const offData = window.desk.onPtyData((id, data) => {
      if (id === sessionId) xterm.write(data)
    })
    const offExit = window.desk.onPtyExit((id, code) => {
      if (id !== sessionId) return
      xterm.write(`\r\n\x1b[2m[claude exited with code ${code}]\x1b[0m\r\n`)
      exitRef.current(code)
    })
    const input = xterm.onData((d) => window.desk.ptyWrite(sessionId, d))
    const resize = xterm.onResize(({ cols, rows }) => window.desk.ptyResize(sessionId, cols, rows))

    window.desk
      .ptyStart({ sessionId, resume, cwd, name, ticket, kickoff, prBranch, cols: xterm.cols, rows: xterm.rows })
      .then((replay) => replay && xterm.write(replay))
      .catch((err) => xterm.write(`\x1b[31mFailed to start claude: ${String(err)}\x1b[0m\r\n`))

    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const retheme = () => (xterm.options.theme = themeFromCss())
    scheme.addEventListener('change', retheme)

    const ro = new ResizeObserver(() => {
      if (host.current && host.current.offsetParent !== null) {
        try {
          fitAddon.fit()
        } catch {
          // Zero-size during layout; next observation fits.
        }
      }
    })
    ro.observe(host.current!)

    return () => {
      ro.disconnect()
      scheme.removeEventListener('change', retheme)
      offData()
      offExit()
      input.dispose()
      resize.dispose()
      xterm.dispose()
    }
    // A terminal is bound to one session for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (!visible) return
    const focus = () => term.current?.focus()
    window.addEventListener('desk:focus-terminal', focus)
    return () => window.removeEventListener('desk:focus-terminal', focus)
  }, [visible])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      try {
        fit.current?.fit()
      } catch {
        // Not laid out yet.
      }
      term.current?.focus()
    })
  }, [visible])

  return <div className="term-host" ref={host} style={{ display: visible ? 'block' : 'none' }} />
}
