import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { store } from './store'

/**
 * The two folders the app works from, per user:
 * - workspace: where new sessions start, and where repos, worktrees and
 *   the ticket context folder live (e.g. ~/Development/acme).
 * - claude dir: Claude Code's state (sessions, transcripts, memory), normally
 *   ~/.claude, or wherever CLAUDE_CONFIG_DIR points.
 */

let shellClaudeDir: string | null | undefined

/** CLAUDE_CONFIG_DIR as the user's login shell sets it (a Dock launch doesn't inherit it). */
export function loadShellClaudeDir(): Promise<void> {
  return new Promise((resolve) =>
    execFile(
      process.env.SHELL || '/bin/zsh',
      ['-ilc', 'printf "__CCD__%s__END__" "$CLAUDE_CONFIG_DIR"'],
      { timeout: 10_000 },
      (_err, stdout) => {
        shellClaudeDir = /__CCD__(.*)__END__/.exec(stdout ?? '')?.[1] || null
        resolve()
      }
    )
  )
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function defaultClaudeDir(): string {
  return shellClaudeDir || join(homedir(), '.claude')
}

export function claudeDir(): string {
  const chosen = store.paths().claudeDir
  return chosen && isDir(chosen) ? chosen : defaultClaudeDir()
}

/** Whether sessions need CLAUDE_CONFIG_DIR set to find the chosen folder. */
export function claudeDirOverride(): string | null {
  const dir = claudeDir()
  return dir === join(homedir(), '.claude') ? null : dir
}

/** The project folder: the one chosen, else SESSION_DESK_CWD, else null (first run: the app asks). */
export function workspace(): string | null {
  const chosen = store.paths().workspace
  if (chosen && isDir(chosen)) return chosen
  const fromEnv = process.env.SESSION_DESK_CWD
  return fromEnv && isDir(fromEnv) ? fromEnv : null
}

/** What a folder holds, for the settings screen to warn about a wrong choice. */
export function describeClaudeDir(dir: string): { sessions: number; exists: boolean } {
  if (!isDir(dir)) return { sessions: 0, exists: false }
  let sessions = 0
  try {
    for (const p of readdirSync(join(dir, 'projects'))) {
      try {
        sessions += readdirSync(join(dir, 'projects', p)).filter((f) => f.endsWith('.jsonl')).length
      } catch {
        // Not a project folder.
      }
    }
  } catch {
    // No projects/ yet.
  }
  return { sessions, exists: true }
}
