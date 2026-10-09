import { promises as fs } from 'node:fs'
import { claudeDir } from './paths'
import { basename, join } from 'node:path'
import type { ArtifactRecord } from '../shared/types'
import { ticketsIn } from './sessions'

// Read at call time: the Claude folder is a setting.
const PROJECTS_DIR = () => join(claudeDir(), 'projects')
const URL_RE = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/
const firstUrl = (text: string) => URL_RE.exec(text)?.[0] ?? null

interface Seen {
  url: string
  sessionId: string
  at: number
  /** publish: the session created or updated it; open: it only opened or read it. */
  kind: 'publish' | 'open'
  description: string
  title: string
}

const cache = new Map<string, { mtimeMs: number; size: number; seen: Seen[] }>()

/** Artifact tool calls, and connector (MCP) tools whose results hand back an artifact link. */
function isArtifactTool(name: string): boolean {
  return name === 'Artifact' || name.startsWith('mcp__')
}

function titleFrom(input: any): string {
  const named = input?.title ?? input?.container?.create?.name
  if (typeof named === 'string' && named.trim()) return named.trim()
  if (typeof input?.file_path === 'string') {
    // my-report.html -> "my report"
    return basename(input.file_path).replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').trim()
  }
  return ''
}

async function scanFile(path: string): Promise<Seen[]> {
  const raw = await fs.readFile(path, 'utf8').catch(() => '')
  const seen: Seen[] = []
  // tool_use id -> what was asked
  const calls = new Map<string, { name: string; input: any; at: number; sessionId: string }>()
  for (const line of raw.split('\n')) {
    if (!line.includes('artifact') && !line.includes('"tool_use"')) continue
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    const content = d.message?.content
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b?.type === 'tool_use' && isArtifactTool(b.name ?? '')) {
        calls.set(b.id, { name: b.name, input: b.input ?? {}, at: Date.parse(d.timestamp) || 0, sessionId: d.sessionId ?? '' })
      } else if (b?.type === 'tool_result' && calls.has(b.tool_use_id)) {
        const call = calls.get(b.tool_use_id)!
        const action = call.input.action
        // Only an Artifact publish (the default action) or a connector creating
        // something counts as making it; open/read/list just reference it.
        const kind: Seen['kind'] =
          call.name === 'Artifact' ? (!action || action === 'publish' ? 'publish' : 'open') : call.input.container?.create ? 'publish' : 'open'
        // An open names the artifact it opened; its result can link the same
        // artifact in another URL form, which would show up as a second entry.
        const inputUrl = typeof call.input.url === 'string' ? firstUrl(call.input.url) : null
        const url = (kind === 'open' && inputUrl) || firstUrl(JSON.stringify(b.content ?? '')) || inputUrl
        if (!url) continue
        {
          seen.push({
            url,
            sessionId: call.sessionId || d.sessionId || '',
            at: call.at,
            kind,
            description: typeof call.input.description === 'string' ? call.input.description : '',
            title: titleFrom(call.input)
          })
        }
      }
    }
  }
  return seen
}

/**
 * Every artifact a session published or opened, newest first, merged by link.
 * `ticketOf` maps a session to its primary ticket.
 */
export async function listArtifacts(ticketOf: (sessionId: string) => string | null, projectsDir = PROJECTS_DIR()): Promise<ArtifactRecord[]> {
  const all: Seen[] = []
  for (const dir of await fs.readdir(projectsDir).catch(() => [] as string[])) {
    for (const f of await fs.readdir(join(projectsDir, dir)).catch(() => [] as string[])) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(projectsDir, dir, f)
      const st = await fs.stat(path).catch(() => null)
      if (!st) continue
      let hit = cache.get(path)
      if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
        hit = { mtimeMs: st.mtimeMs, size: st.size, seen: await scanFile(path) }
        cache.set(path, hit)
      }
      all.push(...hit.seen)
    }
  }

  const byUrl = new Map<string, ArtifactRecord>()
  for (const s of all.sort((a, b) => a.at - b.at)) {
    const r = byUrl.get(s.url) ?? {
      url: s.url,
      title: '',
      description: '',
      published: false,
      firstAt: s.at,
      lastAt: s.at,
      sessions: [],
      tickets: [],
      hidden: false
    }
    // A later publish's words describe the latest version.
    if (s.kind === 'publish') {
      r.published = true
      if (s.description) r.description = s.description
      if (s.title) r.title = s.title
    } else if (!r.title && s.title) r.title = s.title
    r.lastAt = Math.max(r.lastAt, s.at)
    if (s.sessionId && !r.sessions.some((x) => x.id === s.sessionId)) r.sessions.push({ id: s.sessionId, kind: s.kind })
    else if (s.kind === 'publish') {
      const x = r.sessions.find((y) => y.id === s.sessionId)
      if (x) x.kind = 'publish'
    }
    byUrl.set(s.url, r)
  }
  for (const r of byUrl.values()) {
    const fromSessions = r.sessions.map((s) => ticketOf(s.id)).filter((t): t is string => !!t)
    r.tickets = [...new Set([...ticketsIn(`${r.title} ${r.description}`), ...fromSessions])]
  }
  return [...byUrl.values()].sort((a, b) => b.lastAt - a.lastAt)
}
