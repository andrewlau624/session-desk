import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOOK_COMMAND, HOOK_EVENTS, hookState, withHooks, withoutHooks } from '../src/main/hookSettings'
import { tmp } from './helpers'

const home = tmp()
process.env.HOME = home
process.env.SESSION_DESK_TEST_USERDATA = tmp()
const claude = tmp()

const { store } = await import('../src/main/store')
await store.setPath('claudeDir', claude)
const { hookApply, hookPreview, hookStatus } = await import('../src/main/hookInstaller')

const theirs = { hooks: [{ type: 'command', command: 'entire hooks claude-code stop' }] }

describe('hookState', () => {
  it('missing, installed, and installed regardless of where our entries sit', () => {
    expect(hookState({})).toBe('missing')
    const s = withHooks({ model: 'opus' })
    expect(hookState(s)).toBe('installed')
    // Someone added their own hook after ours.
    s.hooks!.Stop.push(theirs as never)
    expect(hookState(s)).toBe('installed')
  })

  it('partial when an event is missing, doubled, or changed', () => {
    const missingOne = withHooks({})
    delete missingOne.hooks!.SessionEnd
    expect(hookState(missingOne)).toBe('partial')
    const doubled = withHooks({})
    doubled.hooks!.Stop.push(structuredClone(doubled.hooks!.Stop[0]))
    expect(hookState(doubled)).toBe('partial')
    const async = withHooks({})
    ;(async.hooks!.Stop[0].hooks![0] as { async?: boolean }).async = true
    expect(hookState(async)).toBe('partial')
  })

  it('install is idempotent and uninstall leaves only what was there', () => {
    const before = { model: 'opus', hooks: { Stop: [theirs] } }
    expect(withHooks(withHooks(before))).toEqual(withHooks(before))
    expect(Object.keys(withHooks(before).hooks!)).toEqual(expect.arrayContaining(Object.keys(HOOK_EVENTS)))
    expect(withoutHooks(withHooks(before))).toEqual(before)
  })
})

describe('in-app installer', () => {
  const settingsFile = join(claude, 'settings.json')

  it('previews, backs up, installs, detects an outdated script, and uninstalls cleanly', async () => {
    writeFileSync(settingsFile, JSON.stringify({ model: 'opus', hooks: { Stop: [theirs] } }, null, 2))
    expect(await hookStatus()).toEqual({ settingsPath: settingsFile, state: 'missing' })

    const diff = await hookPreview('install')
    expect(diff).toContain(HOOK_COMMAND.replace(/"/g, '\\"'))
    expect(diff).toContain('+    "UserPromptSubmit"')

    expect((await hookApply('install')).state).toBe('installed')
    expect(readFileSync(join(home, '.session-desk', 'hook.sh'), 'utf8')).toBe(readFileSync('hooks/status-hook.sh', 'utf8'))
    expect(readdirSync(claude).some((f) => f.startsWith('settings.json.session-desk-backup-'))).toBe(true)
    expect(JSON.parse(readFileSync(settingsFile, 'utf8')).hooks.Stop[0]).toEqual(theirs)
    expect(await hookPreview('install')).toBe('')

    // An older hook script left behind by a previous version.
    writeFileSync(join(home, '.session-desk', 'hook.sh'), '#!/bin/sh\nexit 0\n')
    expect((await hookStatus()).state).toBe('outdated')
    expect((await hookApply('install')).state).toBe('installed')

    expect((await hookApply('uninstall')).state).toBe('missing')
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ model: 'opus', hooks: { Stop: [theirs] } })
  })

  it('refuses to touch a settings.json it cannot parse', async () => {
    writeFileSync(settingsFile, '{ "model": "opus", ')
    await expect(hookApply('install')).rejects.toThrow("isn't valid JSON")
    expect(readFileSync(settingsFile, 'utf8')).toBe('{ "model": "opus", ')
  })
})
