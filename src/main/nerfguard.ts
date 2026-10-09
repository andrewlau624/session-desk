import { execFile } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { NerfguardAction, NerfguardStatus } from '../shared/types'
import { loginPath } from './env'

/**
 * NerfGuard (nerfguard.com) routes Claude Code through a local gateway:
 * `nerfguard enable` points ANTHROPIC_BASE_URL in ~/.claude/settings.json at
 * it, so sessions this app starts go through it just as terminal ones do.
 * Optional: everything here only reads, and nothing runs unless it's installed.
 */
export const NERFGUARD_SITE = 'https://nerfguard.com'

/** `nerfguard` on the login shell's PATH, or where its installer puts it; null when not installed. */
export async function findNerfguard(): Promise<string | null> {
  const dirs = [...(await loginPath()).split(':'), join(homedir(), '.local', 'bin')]
  for (const dir of dirs) {
    if (!dir) continue
    const bin = join(dir, 'nerfguard')
    try {
      await fs.access(bin, constants.X_OK)
      return bin
    } catch {
      // Not here.
    }
  }
  return null
}

/**
 * Reads `nerfguard status`: its sign-in line (checked with the NerfGuard
 * server, so an expired session shows), gateway health and Claude Code's
 * ANTHROPIC_BASE_URL. Lines it doesn't recognise are left as unknown.
 */
export function parseNerfguardStatus(raw: string): Pick<NerfguardStatus, 'enabled' | 'baseUrl' | 'gateway' | 'signIn' | 'email'> {
  const text = raw.replace(/\x1b\[[0-9;]*m/g, '')
  const line = (label: string) => new RegExp(`^${label}:[ \\t]*(.*)$`, 'm').exec(text)?.[1].trim() ?? null
  const sign = line('Nerfguard sign-in') ?? ''
  const signIn = /^signed in as/.test(sign)
    ? 'signed-in'
    : /^session expired/.test(sign)
      ? 'expired'
      : /^not signed in/.test(sign)
        ? 'signed-out'
        : 'unknown'
  const email = /([^\s()]+@[^\s()]+)/.exec(sign)?.[1] ?? null
  const url = line('Claude ANTHROPIC_BASE_URL')
  const baseUrl = url && !url.startsWith('<') ? url : null
  const health = line('Gateway health')
  return { enabled: !!baseUrl, baseUrl, gateway: health === 'running' ? 'running' : health ? 'down' : null, signIn, email }
}

function run(bin: string, args: string[]): Promise<string> {
  return loginPath().then(
    (PATH) =>
      new Promise((resolve, reject) =>
        execFile(bin, args, { env: { ...process.env, PATH, NO_COLOR: '1' }, timeout: 20_000 }, (err, out) =>
          err && !out ? reject(err) : resolve(String(out))
        )
      )
  )
}

/** What the app can run, each in its terminal panel since they may prompt. */
export const NERFGUARD_ACTIONS: Record<Exclude<NerfguardAction, 'install'>, string[]> = {
  enable: ['enable'],
  disable: ['disable'],
  login: ['login'],
  logout: ['logout'],
  dash: ['dash'],
  logs: ['logs']
}

// One check at a time, reused for a minute: `status` starts Python and may refresh the sign-in.
const FRESH_MS = 60_000
let last: NerfguardStatus | null = null
let inFlight: Promise<NerfguardStatus> | null = null

/** After a command ran: the next read checks again. */
export function forgetNerfguardStatus(): void {
  last = null
}

export function nerfguardStatus(force = false): Promise<NerfguardStatus> {
  if (inFlight) return inFlight
  if (!force && last && Date.now() - last.checkedAt < FRESH_MS) return Promise.resolve(last)
  inFlight = check().finally(() => (inFlight = null))
  return inFlight
}

async function check(): Promise<NerfguardStatus> {
  const bin = await findNerfguard()
  const none = { enabled: false, baseUrl: null, gateway: null, signIn: 'unknown', email: null } as const
  if (!bin) return (last = { installed: false, version: null, ...none, checkedAt: Date.now() })
  const [status, version] = await Promise.allSettled([run(bin, ['status']), run(bin, ['version'])])
  last = {
    installed: true,
    version: version.status === 'fulfilled' ? (/(\d+\.\d+\.\d+)/.exec(version.value)?.[1] ?? null) : null,
    ...(status.status === 'fulfilled'
      ? parseNerfguardStatus(status.value)
      : { ...none, error: `Couldn't read nerfguard status: ${(status.reason as Error).message.split('\n')[0]}` }),
    checkedAt: Date.now()
  }
  return last
}
