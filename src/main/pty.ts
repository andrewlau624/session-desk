import * as pty from 'node-pty'
import type { PtyStartRequest } from '../shared/types'
import { claudeDirOverride } from './paths'
import { PLAN_KICKOFFS } from './ticketBrief'
import { statusLineLaunch } from './usage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Variables a Claude host injects into its children (session ids, messaging
// sockets, the child-session marker that disables transcript saving, gateway
// URLs). If this app was itself launched from a Claude session they must not
// reach the claude we spawn. The login shell re-exports anything the user's
// own rc files set.
const HOST_ENV_RE = /^(CLAUDE|ANTHROPIC_|MCP_)/

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !HOST_ENV_RE.test(k)) env[k] = v
  }
  // The variables above are stripped, so a chosen non-default Claude folder
  // has to be passed on explicitly or sessions would use ~/.claude.
  const dir = claudeDirOverride()
  return { ...env, ...(dir ? { CLAUDE_CONFIG_DIR: dir } : {}), TERM: 'xterm-256color', COLORTERM: 'truecolor' }
}

// Replay buffer per terminal so a renderer reload can redraw what was on screen.
const SCROLLBACK_CHARS = 512 * 1024

interface Term {
  proc: pty.IPty
  buffer: string
}

/** A session display name safe to pass to `claude --name`. */
export function cleanName(name: string): string {
  return name.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120)
}

// Run through an interactive login shell so claude sees the same PATH and env
// as a Terminal.app launch (Finder-launched apps get a bare PATH). `exec` makes
// the pty's pid the claude pid. Args go in as positionals, never interpolated
// into the command string.
function spawnClaude(args: string[], cwd: string, cols: number, rows: number): pty.IPty {
  // Our status line, for this session only: it saves the context window and
  // plan limits Claude Code reports, then shows yours if you have one.
  const status = statusLineLaunch()
  return pty.spawn(process.env.SHELL || '/bin/zsh', ['-ilc', 'exec claude "$@"', 'claude', ...status.args, ...args], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...cleanEnv(), ...status.env }
  })
}

export class PtyManager {
  private terms = new Map<string, Term>()
  private headless = new Set<pty.IPty>()

  constructor(
    private onData: (sessionId: string, data: string) => void,
    private onExit: (sessionId: string, code: number) => void
  ) {}

  /** PIDs of the claude processes we own, so the scanner doesn't flag them as "open elsewhere". */
  pids(): Set<number> {
    return new Set([...this.terms.values()].map((t) => t.proc.pid).concat([...this.headless].map((p) => p.pid)))
  }

  has(sessionId: string): boolean {
    return this.terms.has(sessionId)
  }

  /**
   * `brief` is appended to Claude's system prompt: on new sessions, and on a
   * resume that kicks off ticket work. `prompt` is sent as the opening turn.
   */
  start(req: PtyStartRequest, brief?: string, prompt?: string): string {
    if (!UUID_RE.test(req.sessionId)) throw new Error(`not a session id: ${req.sessionId}`)
    const existing = this.terms.get(req.sessionId)
    if (existing) return existing.buffer

    const args = req.resume ? ['--resume', req.sessionId] : ['--session-id', req.sessionId]
    // A ticket session is named up front so it is recognisable everywhere it shows up.
    const name = req.name && cleanName(req.name)
    if (!req.resume && name) args.push('--name', name)
    if (brief && (!req.resume || req.kickoff)) args.push('--append-system-prompt', brief)
    // Planning runs in plan mode: Claude can read but not edit until you approve.
    // The session's own model and effort: flags apply to this process only, unlike /model.
    if (req.launch?.model) args.push('--model', req.launch.model)
    if (req.launch?.effort) args.push('--effort', req.launch.effort)
    if (prompt && req.kickoff && PLAN_KICKOFFS.has(req.kickoff)) args.push('--permission-mode', 'plan')
    if (prompt) args.push('--', prompt)
    const proc = spawnClaude(args, req.cwd, req.cols, req.rows)
    const term: Term = { proc, buffer: '' }
    this.terms.set(req.sessionId, term)

    proc.onData((data) => {
      term.buffer = (term.buffer + data).slice(-SCROLLBACK_CHARS)
      this.onData(req.sessionId, data)
    })
    proc.onExit(({ exitCode }) => {
      this.terms.delete(req.sessionId)
      this.onExit(req.sessionId, exitCode)
    })
    return ''
  }

  /**
   * Resumes a session with no terminal attached, polls `done` until it reports
   * true (or the timeout passes), then stops the process. Nothing is typed into
   * it, so no turn is sent. Resolves whether `done` succeeded.
   */
  async runHeadless(
    sessionId: string,
    cwd: string,
    extraArgs: string[],
    done: () => Promise<boolean>,
    timeoutMs = 30_000
  ): Promise<boolean> {
    if (!UUID_RE.test(sessionId)) throw new Error(`not a session id: ${sessionId}`)
    const proc = spawnClaude(['--resume', sessionId, ...extraArgs], cwd, 120, 40)
    this.headless.add(proc)
    let exited = false
    proc.onExit(() => (exited = true))
    try {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline && !exited) {
        if (await done()) return true
        await new Promise((r) => setTimeout(r, 400))
      }
      return await done()
    } finally {
      if (!exited) proc.kill()
      this.headless.delete(proc)
    }
  }

  write(sessionId: string, data: string): void {
    this.terms.get(sessionId)?.proc.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.terms.get(sessionId)?.proc.resize(cols, rows)
  }

  kill(sessionId: string): void {
    this.terms.get(sessionId)?.proc.kill()
  }

  /**
   * Stops the session's process and resolves once it has exited (SIGKILL after
   * 5s), after the exit has been reported, so a restart never races it.
   */
  stop(sessionId: string): Promise<void> {
    const t = this.terms.get(sessionId)
    if (!t) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          t.proc.kill('SIGKILL')
        } catch {
          // Already gone.
        }
      }, 5000)
      const sub = t.proc.onExit(() => {
        clearTimeout(timer)
        sub.dispose()
        resolve()
      })
      t.proc.kill()
    })
  }

  killAll(): void {
    for (const t of this.terms.values()) t.proc.kill()
    for (const p of this.headless) p.kill()
  }
}
