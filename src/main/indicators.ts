import { app, Notification } from 'electron'
import type { SessionSummary } from '../shared/types'

export interface IndicatorDeps {
  sessions: () => Promise<SessionSummary[]>
  /** Whether this app runs the session (vs. Claude desktop or a terminal). */
  runningHere: (id: string) => boolean
  /** Whether the user is looking at this session right now. */
  viewing: (id: string) => boolean
  prefs: () => { notify: boolean; notifyElsewhere: boolean }
  openSession: (id: string) => void
}

const REASON: Record<string, string> = {
  Stop: 'Finished its turn. Waiting for your reply.',
  PermissionRequest: 'Needs your answer or permission.',
  Notification: 'Needs your attention.',
  StopFailure: 'Stopped with an error.'
}

/**
 * The Dock badge (how many sessions wait on you) and a notification each time
 * a session starts waiting. Sessions already waiting when the app starts are
 * counted but not announced.
 */
export class Indicators {
  // session id -> `at` of the waiting state last seen, so a session that
  // answers and waits again is announced again.
  private waiting = new Map<string, number>()
  private primed = false
  private running = false
  private again = false
  // Notifications are garbage-collected (and their click handlers lost) unless referenced.
  private shown = new Set<Notification>()

  constructor(private deps: IndicatorDeps) {}

  async refresh(): Promise<void> {
    // Coalesce: activity, liveness and file events can all fire together.
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    try {
      const now = (await this.deps.sessions()).filter((s) => s.activity?.state === 'waiting' && !s.archived)
      app.dock?.setBadge(now.length ? String(now.length) : '')
      if (this.primed) for (const s of now) if (this.waiting.get(s.id) !== s.activity!.at) this.announce(s)
      this.waiting = new Map(now.map((s) => [s.id, s.activity!.at]))
      this.primed = true
    } finally {
      this.running = false
      if (this.again) {
        this.again = false
        void this.refresh()
      }
    }
  }

  private announce(s: SessionSummary): void {
    const { notify, notifyElsewhere } = this.deps.prefs()
    if (!notify || !Notification.isSupported()) return
    // Claude desktop and the CLI notify for their own sessions.
    if (!this.deps.runningHere(s.id) && !notifyElsewhere) return
    if (this.deps.viewing(s.id)) return
    const n = new Notification({
      title: s.title,
      subtitle: s.tickets[0],
      body: REASON[s.activity?.event ?? ''] ?? 'Waiting for you.'
    })
    this.shown.add(n)
    n.on('click', () => {
      this.deps.openSession(s.id)
      this.shown.delete(n)
    })
    n.on('close', () => this.shown.delete(n))
    n.show()
  }
}
