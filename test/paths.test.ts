import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { tmp } from './helpers'

// Each user's folders resolve from their own home: point HOME at a scratch one.
const home = tmp()
process.env.HOME = home
process.env.SESSION_DESK_TEST_USERDATA = tmp()
delete process.env.SESSION_DESK_CWD

const { claudeDir, claudeDirOverride, defaultClaudeDir, describeClaudeDir, workspace } = await import('../src/main/paths')
const { store } = await import('../src/main/store')

describe('projects folder', () => {
  beforeEach(async () => {
    await store.setPath('workspace', null)
    rmSync(join(home, 'Development'), { recursive: true, force: true })
  })

  it('is unset for a new user, so the app asks', () => {
    expect(workspace()).toBeNull()
  })

  it('never guesses a folder: only one chosen, or SESSION_DESK_CWD', () => {
    mkdirSync(join(home, 'Development', 'acme-app'), { recursive: true })
    expect(workspace()).toBeNull()
    process.env.SESSION_DESK_CWD = join(home, 'Development', 'acme-app')
    try {
      expect(workspace()).toBe(join(home, 'Development', 'acme-app'))
    } finally {
      delete process.env.SESSION_DESK_CWD
    }
  })

  it('a chosen folder wins; one deleted since falls back', async () => {
    const chosen = join(tmp(), 'projects')
    mkdirSync(chosen)
    await store.setPath('workspace', chosen)
    expect(workspace()).toBe(chosen)
    rmSync(chosen, { recursive: true })
    expect(workspace()).toBeNull()
  })
})

describe('Claude Code folder', () => {
  beforeEach(async () => {
    await store.setPath('claudeDir', null)
  })

  it('defaults to ~/.claude, which sessions find without help', () => {
    expect(defaultClaudeDir()).toBe(join(home, '.claude'))
    expect(claudeDir()).toBe(join(home, '.claude'))
    expect(claudeDirOverride()).toBeNull()
  })

  it('a chosen folder is passed to new sessions as CLAUDE_CONFIG_DIR', async () => {
    const chosen = tmp()
    await store.setPath('claudeDir', chosen)
    expect(claudeDir()).toBe(chosen)
    expect(claudeDirOverride()).toBe(chosen)
  })

  it('counts transcripts, so a wrong pick can be flagged', () => {
    const dir = tmp()
    expect(describeClaudeDir(dir)).toEqual({ sessions: 0, exists: true })
    mkdirSync(join(dir, 'projects', '-p'), { recursive: true })
    for (const n of ['a', 'b']) writeFileSync(join(dir, 'projects', '-p', `${n}.jsonl`), '')
    expect(describeClaudeDir(dir)).toEqual({ sessions: 2, exists: true })
    expect(describeClaudeDir(join(dir, 'missing')).exists).toBe(false)
  })
})
