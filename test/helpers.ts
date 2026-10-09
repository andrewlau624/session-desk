import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrLink, SessionSummary } from '../src/shared/types'

export const tmp = (prefix = 'session-desk-test-') => mkdtempSync(join(tmpdir(), prefix))

/** Writes a Claude Code transcript (.jsonl) under <claudeDir>/projects/<project>/. */
export function writeTranscript(claudeDir: string, id: string, entries: object[], project = '-test-project'): string {
  const dir = join(claudeDir, 'projects', project)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${id}.jsonl`)
  writeFileSync(path, entries.map((e) => JSON.stringify({ sessionId: id, ...e })).join('\n') + '\n')
  return path
}

/** A real user turn, as Claude Code records it. */
export const userTurn = (text: string, extra: object = {}) => ({
  type: 'user',
  timestamp: '2026-10-01T10:00:00.000Z',
  cwd: '/work/acme-app',
  gitBranch: 'HEAD',
  entrypoint: 'cli',
  message: { role: 'user', content: text },
  ...extra
})

export function session(over: Partial<SessionSummary>): SessionSummary {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    transcriptPath: '',
    startCwd: '/work/acme-app',
    title: 'a session',
    titleSource: 'ai',
    tickets: [],
    ticketSource: null,
    prs: [],
    entrypoint: 'cli',
    lastActivity: 1,
    liveElsewhere: null,
    archived: false,
    groupId: null,
    pinned: false,
    activity: null,
    plan: 'none',
    worked: false,
    turnEndedAt: 0,
    ...over
  }
}

export const pr = (n: number, headRef: string, state: 'OPEN' | 'MERGED' | 'CLOSED' = 'MERGED'): PrLink => ({
  repo: 'acme/api',
  number: n,
  url: `https://github.com/acme/api/pull/${n}`,
  info: { title: `PR ${n}`, state, draft: false, headRef }
})
