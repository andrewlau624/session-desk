import * as pty from 'node-pty'
import { loginPath } from './env'

/**
 * One command at a time in a real terminal, for CLIs that prompt (sign-in
 * codes, passwords, yes/no questions): the app shows its screen and passes
 * your keys through, so nothing is answered for you.
 */
export class ToolTerminal {
  private proc: pty.IPty | null = null

  constructor(
    private onData: (data: string) => void,
    private onExit: (code: number) => void
  ) {}

  get running(): boolean {
    return this.proc !== null
  }

  async start(bin: string, args: string[], cols: number, rows: number): Promise<void> {
    if (this.proc) throw new Error('A command is already running; stop it first')
    const PATH = await loginPath()
    const proc = pty.spawn(bin, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
      env: { ...process.env, PATH, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
    })
    this.proc = proc
    proc.onData((d) => this.onData(d))
    proc.onExit(({ exitCode }) => {
      if (this.proc === proc) this.proc = null
      this.onExit(exitCode)
    })
  }

  write(data: string): void {
    this.proc?.write(data)
  }

  resize(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.proc?.resize(cols, rows)
  }

  /** On quit: nothing is left running behind the app. */
  kill(): void {
    this.proc?.kill()
    this.proc = null
  }

  /** Ctrl-C first, as you would; a command that ignores it is killed shortly after. */
  stop(): void {
    const proc = this.proc
    if (!proc) return
    proc.write('\x03')
    setTimeout(() => {
      if (this.proc === proc) proc.kill()
    }, 1500)
  }
}
