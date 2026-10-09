import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Per-session activity written by the Claude Code hook (hooks/status-hook.sh):
 * one small JSON file per session id under ~/.session-desk/status.
 */
export const STATUS_DIR = join(homedir(), '.session-desk', 'status')

export type Activity = 'working' | 'waiting'

export interface SessionActivity {
  state: Activity
  /** The hook event that set it, e.g. Stop or UserPromptSubmit. */
  event: string
  /** Unix seconds. */
  at: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let current = new Map<string, SessionActivity>()

/**
 * The hook's activity, corrected by the transcript. Dismissing a question or a
 * permission prompt with Esc interrupts the turn, and Claude Code runs no hook
 * for that (measured on 2.1.295: nothing for 100s after), so the file still
 * says PermissionRequest while the session sits idle at its prompt. The
 * transcript does record the turn ending; one that ended after the hook's
 * last waiting event means idle (event TurnEnded).
 */
export function withTurnEnd(a: SessionActivity | null, turnEndedAt: number): SessionActivity | null {
  if (!a || a.state !== 'waiting' || a.event === 'Stop' || a.event === 'StopFailure') return a
  // `at` is whole seconds: allow for that rather than mistake the previous turn's end.
  return turnEndedAt > (a.at + 1) * 1000 ? { ...a, event: 'TurnEnded' } : a
}

export function activityOf(sessionId: string): SessionActivity | null {
  return current.get(sessionId) ?? null
}

async function readAll(): Promise<Map<string, SessionActivity>> {
  const next = new Map<string, SessionActivity>()
  const names = await fs.readdir(STATUS_DIR).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((n) => UUID_RE.test(n))
      .map(async (n) => {
        try {
          const d = JSON.parse(await fs.readFile(join(STATUS_DIR, n), 'utf8'))
          if ((d.state === 'working' || d.state === 'waiting') && typeof d.at === 'number') {
            next.set(n, { state: d.state, event: String(d.event ?? ''), at: d.at })
          }
        } catch {
          // Mid-write or malformed; the next change event re-reads it.
        }
      })
  )
  return next
}

/** Loads current state and calls `onChange` (debounced) whenever a session's activity changes. */
export async function watchActivity(onChange: () => void): Promise<() => void> {
  await fs.mkdir(STATUS_DIR, { recursive: true })
  current = await readAll()
  let timer: NodeJS.Timeout | undefined
  const w: FSWatcher = watch(STATUS_DIR, () => {
    clearTimeout(timer)
    // Short debounce: a turn ending should show up promptly.
    timer = setTimeout(async () => {
      current = await readAll()
      onChange()
    }, 150)
  })
  return () => w.close()
}
