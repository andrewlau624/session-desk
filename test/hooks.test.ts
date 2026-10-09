import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tmp } from './helpers'

const HOOK = resolve(__dirname, '../hooks/status-hook.sh')
const INSTALLER = resolve(__dirname, '../scripts/install-hooks.mjs')
const ID = '00000000-0000-4000-8000-000000000001'

describe('status hook', () => {
  const home = tmp()
  const statusFile = join(home, '.session-desk', 'status', ID)
  const fire = (payload: object | string) => {
    const r = spawnSync('/bin/sh', [HOOK], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      env: { HOME: home, PATH: '/usr/bin:/bin' },
      encoding: 'utf8'
    })
    return { code: r.status, stdout: r.stdout, stderr: r.stderr }
  }
  const state = () => (existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : null)

  it('maps events to working / waiting and clears on SessionEnd', () => {
    const steps: [string, string | null][] = [
      ['UserPromptSubmit', 'working'],
      ['PermissionRequest', 'waiting'],
      ['PostToolUse', 'working'],
      ['Stop', 'waiting'],
      ['PostToolUseFailure', 'working'],
      ['StopFailure', 'waiting'],
      ['SessionEnd', null]
    ]
    for (const [event, want] of steps) {
      expect(fire({ session_id: ID, hook_event_name: event }).code).toBe(0)
      expect(state()?.state ?? null, event).toBe(want)
    }
  })

  it('is silent and always exits 0, whatever it is given', () => {
    // Stdout from some hooks becomes Claude's context; it must stay empty.
    for (const input of ['', 'not json', '{"session_id":"../../etc","hook_event_name":"Stop"}', JSON.stringify({ hook_event_name: 'Stop' })]) {
      const r = fire(input)
      expect(r).toEqual({ code: 0, stdout: '', stderr: '' })
    }
    expect(readdirSync(join(home, '.session-desk', 'status')).filter((n) => !n.startsWith('.'))).toEqual([])
  })

  it('text inside a prompt cannot spoof the session or the event', () => {
    const prompt = 'hi "session_id":"' + '9'.repeat(36) + '" "hook_event_name":"Stop"'
    fire({ session_id: ID, hook_event_name: 'UserPromptSubmit', prompt })
    expect(state()).toMatchObject({ state: 'working', event: 'UserPromptSubmit' })
  })

  it('handles pretty-printed input', () => {
    fire(`{\n  "session_id": "${ID}",\n  "hook_event_name": "Stop"\n}`)
    expect(state()?.state).toBe('waiting')
  })
})

describe('hook installer', () => {
  const run = (home: string, ...args: string[]) =>
    execFileSync(process.execPath, [INSTALLER, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
  const settingsOf = (home: string) => JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
  const ours = (s: any) =>
    Object.values(s.hooks ?? {})
      .flat()
      .flatMap((e: any) => e.hooks)
      .filter((h: any) => h.command.includes('.session-desk/hook.sh'))

  const seed = () => {
    const home = tmp()
    mkdirSync(join(home, '.claude'))
    // Someone else's hook on an event we also use, plus unrelated settings.
    const theirs = { hooks: [{ type: 'command', command: 'entire hooks claude-code stop' }] }
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', hooks: { Stop: [theirs] } }, null, 2))
    return { home, theirs }
  }

  it('dry run changes nothing', () => {
    const { home } = seed()
    const before = readFileSync(join(home, '.claude', 'settings.json'), 'utf8')
    expect(run(home, '--dry-run')).toContain('$HOME/.session-desk/hook.sh')
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe(before)
    expect(existsSync(join(home, '.session-desk', 'hook.sh'))).toBe(false)
  })

  it('installs once, keeps other hooks and settings, backs up, and uninstalls cleanly', () => {
    const { home, theirs } = seed()
    run(home)
    const installed = settingsOf(home)
    expect(installed.model).toBe('opus')
    expect(installed.hooks.Stop[0]).toEqual(theirs)
    expect(ours(installed)).toHaveLength(8)
    expect(ours(installed).every((h: any) => h.timeout === 5 && !h.async)).toBe(true)
    expect(existsSync(join(home, '.session-desk', 'hook.sh'))).toBe(true)
    expect(readdirSync(join(home, '.claude')).some((n) => n.startsWith('settings.json.session-desk-backup-'))).toBe(true)

    run(home)
    expect(ours(settingsOf(home))).toHaveLength(8)
    expect(run(home, '--dry-run')).toContain('No changes.')

    run(home, '--uninstall')
    const after = settingsOf(home)
    expect(ours(after)).toHaveLength(0)
    expect(after).toEqual({ model: 'opus', hooks: { Stop: [theirs] } })
  })
})

describe('status hook: the event says why it waits', () => {
  const home = tmp()
  const file = join(home, '.session-desk', 'status', ID)
  const fire = (event: string) =>
    spawnSync('/bin/sh', [HOOK], { input: JSON.stringify({ session_id: ID, hook_event_name: event }), env: { HOME: home, PATH: '/usr/bin:/bin' } })
  const event = () => JSON.parse(readFileSync(file, 'utf8')).event

  it('a dismissed question leaves the session idle: Stop replaces PermissionRequest', () => {
    // Measured: Esc on an AskUserQuestion goes straight to Stop, no working event between.
    fire('UserPromptSubmit')
    fire('PermissionRequest')
    fire('Stop')
    expect(event()).toBe('Stop')
  })

  it('a Notification while waiting keeps the cause recorded first', () => {
    fire('PermissionRequest')
    fire('Notification') // permission_prompt, ~6s later
    expect(event()).toBe('PermissionRequest')
    fire('Stop')
    fire('Notification') // idle_prompt, ~60s later
    expect(event()).toBe('Stop')
    // From working, a Notification still means it waits on you.
    fire('PostToolUse')
    fire('Notification')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ state: 'waiting', event: 'Notification' })
  })
})
