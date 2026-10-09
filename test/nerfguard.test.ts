import { describe, expect, it } from 'vitest'
import { parseNerfguardStatus } from '../src/main/nerfguard'
import { nerfguardActions, nerfguardLook, nerfguardSummary } from '../src/renderer/src/components/NerfguardButton'
import { routeReady } from '../src/renderer/src/components/NerfguardPanel'
import type { NerfguardStatus } from '../src/shared/types'

// `nerfguard status` as printed by 0.3.16 (trimmed; the plugin list that follows is ignored).
const status = (sign: string, health: string, baseUrl: string) =>
  [
    `Nerfguard sign-in: ${sign}`,
    'State file: /Users/someone/.nerfguard/state.json (present)',
    'Claude settings: /Users/someone/.claude/settings.json (present)',
    'Provider auth mode: account_login',
    'Ultra mode: off',
    `Gateway health: ${health}`,
    `Claude ANTHROPIC_BASE_URL: ${baseUrl}`,
    'Codex nerfguard provider: not enabled',
    'Claude Code plugins: 2 installed, 1 enabled, NOT routed via gateway'
  ].join('\n')

describe('reading nerfguard status', () => {
  it('reads an enabled, healthy, signed-in install', () => {
    expect(parseNerfguardStatus(status('signed in as dev@example.com', 'running', 'http://127.0.0.1:17322'))).toEqual({
      enabled: true,
      baseUrl: 'http://127.0.0.1:17322',
      gateway: 'running',
      signIn: 'signed-in',
      email: 'dev@example.com'
    })
  })

  it('reads a disabled install with an expired sign-in', () => {
    const s = parseNerfguardStatus(
      status('session expired (dev@example.com) — run `nerfguard login` to sign back in', 'not reachable', '<unset>')
    )
    expect(s).toEqual({ enabled: false, baseUrl: null, gateway: 'down', signIn: 'expired', email: 'dev@example.com' })
  })

  it('reads signed out, coloured output, and lines it does not know', () => {
    expect(parseNerfguardStatus(status('\x1b[2mnot signed in — run `nerfguard login`\x1b[0m', 'unhealthy (503)', '<unreadable>'))).toMatchObject({
      enabled: false,
      gateway: 'down',
      signIn: 'signed-out',
      email: null
    })
    expect(parseNerfguardStatus('something else entirely')).toEqual({
      enabled: false,
      baseUrl: null,
      gateway: null,
      signIn: 'unknown',
      email: null
    })
  })
})

describe('the NerfGuard button', () => {
  const base: NerfguardStatus = {
    installed: true,
    version: '0.3.16',
    enabled: true,
    baseUrl: 'http://127.0.0.1:17322',
    gateway: 'running',
    signIn: 'signed-in',
    email: 'dev@example.com',
    checkedAt: 0
  }

  it('picks the icon from the state, most urgent first', () => {
    expect(nerfguardLook({ ...base, installed: false }).look).toBe('missing')
    expect(nerfguardLook({ ...base, enabled: false }).look).toBe('off')
    expect(nerfguardLook(base).look).toBe('on')
    expect(nerfguardLook({ ...base, gateway: 'down' }).look).toBe('warn')
    expect(nerfguardLook({ ...base, signIn: 'expired' }).look).toBe('warn')
    expect(nerfguardLook({ ...base, error: 'boom' }).look).toBe('warn')
  })

  it('says how Claude Code is routed and who is signed in', () => {
    expect(nerfguardSummary(base)).toEqual(['On: Claude Code goes through it', 'Signed in as dev@example.com'])
    expect(nerfguardSummary({ ...base, enabled: false, signIn: 'expired' })).toEqual([
      'Off: Claude Code connects directly',
      'Sign-in expired (dev@example.com)'
    ])
    expect(nerfguardSummary({ ...base, installed: false })).toEqual(['Not installed'])
  })
})

describe('NerfGuard commands', () => {
  const base: NerfguardStatus = {
    installed: true,
    version: '0.3.16',
    enabled: false,
    baseUrl: null,
    gateway: 'down',
    signIn: 'expired',
    email: null,
    checkedAt: 0
  }
  const actions = (s: NerfguardStatus) => nerfguardActions(s).map((a) => a.action)

  it('offers what fits the state', () => {
    expect(actions(base)).toEqual(['enable', 'login'])
    expect(actions({ ...base, enabled: true, gateway: 'running', signIn: 'signed-in' })).toEqual(['disable', 'logout'])
    // On but its gateway is down: turning on again restarts it.
    expect(actions({ ...base, enabled: true })).toEqual(['enable', 'disable', 'login'])
    expect(actions({ ...base, installed: false })).toEqual([])
    expect(actions({ ...base, error: 'boom' })).toEqual([])
  })

  it('offers restarts only once the new route works', () => {
    const on = { ...base, enabled: true, gateway: 'running' as const }
    expect(routeReady('enable', 0, on)).toBe(true)
    // Enabled, but a session restarted now couldn't connect.
    expect(routeReady('enable', 0, { ...on, gateway: 'down' })).toBe(false)
    expect(routeReady('enable', 1, on)).toBe(false)
    expect(routeReady('enable', 0, null)).toBe(false)
    expect(routeReady('disable', 0, base)).toBe(true)
    expect(routeReady('disable', 0, on)).toBe(false)
    expect(routeReady('login', 0, on)).toBeNull()
    expect(routeReady('logs', 0, on)).toBeNull()
  })
})
