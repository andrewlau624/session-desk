/**
 * Coalesces terminal output on its way to the window. A streaming session
 * writes many small chunks; sending each as its own IPC message cost more in
 * both processes than the text itself. Output of the session on screen goes
 * out at the end of the current event-loop turn (no added latency). Hidden
 * sessions' output nobody is looking at goes out every BACKGROUND_FLUSH_MS,
 * all sessions in one message, so their terminals parse it in a few large
 * writes instead of hundreds of small ones; switching to one flushes first.
 */
export const BACKGROUND_FLUSH_MS = 250

/**
 * Output that asks the terminal something and waits for its answer: device
 * status and cursor position (CSI n), device attributes (CSI c), mode and
 * colour queries (CSI ? … $p, OSC 10/11/… ;?). Sent at once even when hidden.
 */
export const QUERY_RE = /\x1b\[[?>=]?[\d;]*[nc]|\x1b\[\?[\d;]*\$p|\x1b\]\d+;\?/

/** A hidden session dumping a large file doesn't wait for the timer (bounds what is held). */
const MAX_HELD_CHARS = 1024 * 1024

export class PtyBatcher {
  private pending = new Map<string, string>()
  private immediate: NodeJS.Immediate | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private send: (batch: [string, string][]) => void,
    /** The session on screen, whose output is not held back. */
    private active: () => string | null
  ) {}

  push(id: string, data: string): void {
    const held = (this.pending.get(id) ?? '') + data
    this.pending.set(id, held)
    if (id === this.active() || QUERY_RE.test(data) || held.length > MAX_HELD_CHARS) this.immediate ??= setImmediate(() => this.flush())
    else this.timer ??= setTimeout(() => this.flush(), BACKGROUND_FLUSH_MS)
  }

  /** Sends everything held; call before anything that must follow a session's output (its exit). */
  flush(): void {
    if (this.immediate) clearImmediate(this.immediate)
    if (this.timer) clearTimeout(this.timer)
    this.immediate = this.timer = null
    if (!this.pending.size) return
    const batch = [...this.pending]
    this.pending.clear()
    this.send(batch)
  }
}
