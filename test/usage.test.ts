import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSession } from '../src/main/sessions'
import { SCRIPT_TEXT, parseStatusInput, readUsage, autoCompactAt } from '../src/main/usage'
import { contextLabel, resetLabel } from '../src/renderer/src/components/UsageButton'
import { tmp, userTurn, writeTranscript } from './helpers'

const ID = '55555555-5555-4555-8555-555555555555'
const OTHER = '66666666-6666-4666-8666-666666666666'
// Shaped like what Claude Code 2.1.295 passes a status line (trimmed).
const input = (id: string, used: number, fiveHour = 30) => ({
  session_id: id,
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  context_window: { total_input_tokens: used, total_output_tokens: 4, context_window_size: 1_000_000, used_percentage: 5, remaining_percentage: 95 },
  rate_limits: { five_hour: { used_percentage: fiveHour, resets_at: 1791590400 }, seven_day: { used_percentage: 40, resets_at: 1791734400 } }
})

describe('the status line script', () => {
  const run = (stdin: string, env: Record<string, string> = {}) => {
    const home = tmp()
    const script = join(home, 'statusline.sh')
    writeFileSync(script, SCRIPT_TEXT, { mode: 0o755 })
    const r = spawnSync('/bin/sh', [script], { input: stdin, env: { HOME: home, PATH: '/usr/bin:/bin', ...env }, encoding: 'utf8' })
    return { home, r }
  }

  it('saves what Claude Code passes, per session, and prints nothing of its own', () => {
    const { home, r } = run(JSON.stringify(input(ID, 50663)))
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(JSON.parse(readFileSync(join(home, '.session-desk', 'usage', `${ID}.json`), 'utf8')).context_window.total_input_tokens).toBe(50663)
  })

  it('still shows your own status line, with the same input', () => {
    const { r } = run(JSON.stringify(input(ID, 1)), { SESSION_DESK_STATUSLINE_NEXT: 'grep -o "Opus 5.5" | head -1' })
    expect(r.stdout.trim()).toBe('Opus 5.5')
  })

  it('ignores input without a proper session id', () => {
    const { home, r } = run(JSON.stringify({ session_id: '../../x', context_window: {} }))
    expect(r.status).toBe(0)
    expect(existsSync(join(home, '.session-desk', 'usage'))).toBe(false)
  })
})

describe('reading usage', () => {
  it('parses the context window and limits; auto-compact only where documented (1M)', () => {
    const u = parseStatusInput(input(ID, 847_400), 1)
    expect(u.context).toEqual({ used: 847_400, size: 1_000_000, autoCompactAt: 967_000 })
    expect(u.limits?.fiveHour).toEqual({ usedPercent: 30, resetsAt: 1791590400_000 })
    expect(autoCompactAt(200_000)).toBeNull()
  })

  it("a session's own context, and the newest limits from any session", async () => {
    const dir = tmp()
    writeFileSync(join(dir, `${ID}.json`), JSON.stringify(input(ID, 100_000, 30)))
    writeFileSync(join(dir, `${OTHER}.json`), JSON.stringify(input(OTHER, 5, 55)))
    utimesSync(join(dir, `${ID}.json`), 1000, 1000)
    const u = await readUsage(ID, null, dir)
    expect(u.source).toBe('status-line')
    expect(u.context?.used).toBe(100_000)
    // Limits are account-wide: the other session's are newer.
    expect(u.limits?.fiveHour?.usedPercent).toBe(55)
  })

  it('falls back to the transcript’s token count (window size unknown)', async () => {
    const dir = tmp()
    mkdirSync(dir, { recursive: true })
    expect(await readUsage(ID, 891_819, dir)).toMatchObject({ source: 'transcript', context: { used: 891_819, size: null } })
    expect((await readUsage(ID, null, dir)).source).toBe('none')
  })

  it('the transcript count is the latest reply’s input plus cache, ignoring quoted text', async () => {
    const reply = (usage: object, text = 'ok') => ({
      type: 'assistant',
      sessionId: ID,
      message: { model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }], usage }
    })
    const s = await parseSession(
      writeTranscript(tmp(), ID, [
        userTurn('hi'),
        reply({ input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }),
        reply({ input_tokens: 2, cache_creation_input_tokens: 20, cache_read_input_tokens: 2000, output_tokens: 5 }, 'he wrote "input_tokens":999999')
      ])
    )
    expect(s?.contextTokens).toBe(2022)
  })

  it('labels', () => {
    expect(contextLabel({ used: 847_400, size: 1_000_000, autoCompactAt: 967_000 })).toBe('847.4k / 1M (85%)')
    expect(contextLabel({ used: 12_345, size: null, autoCompactAt: null })).toBe('12.3k tokens')
    expect(resetLabel(Date.now() + (2 * 60 + 41) * 60_000 + 20_000)).toBe('Resets in 2 hr 41 min')
    expect(resetLabel(null)).toBe('')
  })
})
