import { readFileSync, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SessionUsage, UsageLimit } from '../shared/types'
import { claudeDir } from './paths'

/**
 * What Claude Code hands its status line after each reply (documented at
 * code.claude.com/docs/en/statusline): the context window and the plan's
 * rate limits. Sessions this app starts get a status line of our own, passed
 * with `--settings` (so your settings never change), that saves it here.
 */
export const USAGE_DIR = join(homedir(), '.session-desk', 'usage')
const SCRIPT = join(homedir(), '.session-desk', 'statusline.sh')

// Saves the input per session, then shows your own status line if you have one
// (its command comes in SESSION_DESK_STATUSLINE_NEXT), so nothing you see changes.
export const SCRIPT_TEXT = `#!/bin/sh
# Session Desk status line. Saves what Claude Code passes a status line
# (context window, rate limits) for the app, then runs your own status line,
# if you have one, with the same input. Prints nothing else; always exits 0.
umask 077
input=$(cat)
dir="$HOME/.session-desk/usage"
sid=$(printf '%s' "$input" | grep -o '"session_id" *: *"[0-9a-f-]*"' | head -n 1 | sed 's/.*"\\([0-9a-f-]*\\)"$/\\1/')
case "$sid" in
  '' | *[!0-9a-f-]*) ;;
  *) mkdir -p "$dir" 2>/dev/null && printf '%s' "$input" >"$dir/.$sid.$$" 2>/dev/null && mv -f "$dir/.$sid.$$" "$dir/$sid.json" 2>/dev/null ;;
esac
if [ -n "$SESSION_DESK_STATUSLINE_NEXT" ]; then
  printf '%s' "$input" | sh -c "$SESSION_DESK_STATUSLINE_NEXT"
fi
exit 0
`

/** Writes the status line script (an app-owned file) when it's missing or out of date. */
export async function installStatusLine(): Promise<void> {
  const have = await fs.readFile(SCRIPT, 'utf8').catch(() => null)
  if (have === SCRIPT_TEXT) return
  await fs.mkdir(join(homedir(), '.session-desk'), { recursive: true })
  await fs.writeFile(SCRIPT, SCRIPT_TEXT, { mode: 0o755 })
  await fs.chmod(SCRIPT, 0o755)
}

/** Your own status line command from Claude Code's settings, to keep showing it. */
function userStatusLine(): string | null {
  try {
    const s = JSON.parse(readFileSync(join(claudeDir(), 'settings.json'), 'utf8'))
    return s?.statusLine?.type === 'command' && typeof s.statusLine.command === 'string' ? s.statusLine.command : null
  } catch {
    return null
  }
}

/** The extra launch arguments and environment that give a session our status line. */
export function statusLineLaunch(): { args: string[]; env: Record<string, string> } {
  const next = userStatusLine()
  return {
    args: ['--settings', JSON.stringify({ statusLine: { type: 'command', command: SCRIPT } })],
    env: next ? { SESSION_DESK_STATUSLINE_NEXT: next } : {}
  }
}

/** About where Claude Code auto-compacts: documented for 1M-context models; unknown otherwise. */
export function autoCompactAt(windowSize: number): number | null {
  return windowSize >= 1_000_000 ? 967_000 : null
}

const limit = (v: any): UsageLimit | null =>
  v && typeof v.used_percentage === 'number' ? { usedPercent: v.used_percentage, resetsAt: typeof v.resets_at === 'number' ? v.resets_at * 1000 : null } : null

/** Parses one saved status line input. */
export function parseStatusInput(raw: any, savedAt: number): Omit<SessionUsage, 'source'> {
  const cw = raw?.context_window
  const size = typeof cw?.context_window_size === 'number' ? cw.context_window_size : null
  const used = typeof cw?.total_input_tokens === 'number' ? cw.total_input_tokens : null
  const rl = raw?.rate_limits
  return {
    context: size && used !== null ? { used, size, autoCompactAt: autoCompactAt(size) } : null,
    limits: rl ? { fiveHour: limit(rl.five_hour), sevenDay: limit(rl.seven_day), at: savedAt } : null,
    at: savedAt
  }
}

async function readSaved(file: string): Promise<{ raw: any; at: number } | null> {
  try {
    const [text, st] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
    return { raw: JSON.parse(text), at: st.mtimeMs }
  } catch {
    return null
  }
}

/**
 * A session's context (from its own status line, else just the token count
 * from its transcript) and the plan's limits, which are account-wide: the most
 * recently saved ones from any session.
 */
export async function readUsage(sessionId: string, transcriptTokens: number | null, dir = USAGE_DIR): Promise<SessionUsage> {
  const own = await readSaved(join(dir, `${sessionId}.json`))
  const mine = own ? parseStatusInput(own.raw, own.at) : null
  let limits = mine?.limits ?? null
  const names = await fs.readdir(dir).catch(() => [] as string[])
  for (const n of names.filter((n) => n.endsWith('.json'))) {
    const st = await fs.stat(join(dir, n)).catch(() => null)
    if (!st || (limits && st.mtimeMs <= limits.at)) continue
    const s = await readSaved(join(dir, n))
    const l = s && parseStatusInput(s.raw, s.at).limits
    if (l && (l.fiveHour || l.sevenDay)) limits = l
  }
  if (mine?.context) return { source: 'status-line', context: mine.context, limits, at: mine.at }
  return {
    source: transcriptTokens !== null ? 'transcript' : 'none',
    context: transcriptTokens !== null ? { used: transcriptTokens, size: null, autoCompactAt: null } : null,
    limits,
    at: own?.at ?? null
  }
}
