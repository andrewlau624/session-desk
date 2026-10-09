import { promises as fs } from 'node:fs'
import { claudeDir } from './paths'
import { projectConfig } from './projectConfig'
import { join, sep } from 'node:path'
import type { TicketContext } from '../shared/types'

// Read at call time: the Claude folder is a setting.
const PROJECTS_DIR = () => join(claudeDir(), 'projects')
// Project keys for throwaway folders (temp dirs, test scratchpads) hold no
// notes about real tickets.
const SCRATCH_PROJECT_RE = /^-(private-tmp|tmp|var-folders)-/
const MAX_NOTES = 12

async function countFiles(dir: string): Promise<{ files: number; modifiedAt: number }> {
  let files = 0
  let modifiedAt = 0
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        files++
        modifiedAt = Math.max(modifiedAt, (await fs.stat(p).catch(() => null))?.mtimeMs ?? 0)
      }
    }
  }
  await walk(dir)
  return { files, modifiedAt }
}

/**
 * Folders in the project's context folder (`contextFolder`, e.g. evidence/)
 * named for the ticket (any case) or for one of the session's PRs (PR-9107).
 */
async function evidenceFor(workspace: string | null, ticket: string | null, prNumbers: number[]): Promise<TicketContext['evidence']> {
  const folder = projectConfig().contextFolder
  if (!workspace || !folder) return []
  const root = join(workspace, folder)
  const wanted = new Set([...(ticket ? [ticket.toLowerCase()] : []), ...prNumbers.map((n) => `pr-${n}`)])
  const out: TicketContext['evidence'] = []
  for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !wanted.has(e.name.toLowerCase())) continue
    out.push({ path: join(root, e.name), label: `${folder}/${e.name}`, ...(await countFiles(join(root, e.name))) })
  }
  return out
}

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  const fields: Record<string, string> = {}
  for (const line of m?.[1].split('\n') ?? []) {
    const kv = /^(\w+):\s*(.*)$/.exec(line)
    if (!kv) continue
    const v = kv[2].trim()
    // YAML double-quoted values escape their quotes and backslashes.
    if (/^".*"$/.test(v)) fields[kv[1]] = v.slice(1, -1).replace(/\\(["\\])/g, '$1')
    else if (/^'.*'$/.test(v)) fields[kv[1]] = v.slice(1, -1).replace(/''/g, "'")
    else fields[kv[1]] = v
  }
  return fields
}

/** Claude Code memory notes that mention the ticket, file-name matches first. */
async function notesFor(ticket: string, projectsDir: string): Promise<TicketContext['notes']> {
  const id = ticket.toLowerCase()
  const mention = new RegExp(`\\b${ticket.replace('-', '[-_ ]?')}\\b`, 'gi')
  const notes: (TicketContext['notes'][number] & { score: number })[] = []
  for (const project of await fs.readdir(projectsDir).catch(() => [] as string[])) {
    if (SCRATCH_PROJECT_RE.test(project)) continue
    const dir = join(projectsDir, project, 'memory')
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      // MEMORY.md is the index: it mentions everything.
      if (!name.endsWith('.md') || name === 'MEMORY.md') continue
      const path = join(dir, name)
      const text = await fs.readFile(path, 'utf8').catch(() => '')
      const mentions = (text.match(mention) ?? []).length
      const inName = name.toLowerCase().includes(id)
      if (!mentions && !inName) continue
      const fm = frontmatter(text)
      notes.push({
        path,
        name: fm.name || name.replace(/\.md$/, ''),
        description: fm.description ?? '',
        project: project.replace(/^-Users-[^-]+-/, '').replace(/^Development-/, '') || '~',
        mentions,
        score: (inName ? 1000 : 0) + mentions
      })
    }
  }
  return notes
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NOTES)
    .map(({ score: _s, ...n }) => n)
}

export async function ticketContext(
  workspace: string | null,
  ticket: string | null,
  prNumbers: number[],
  /** Claude Code's projects folder; tests point this at fixtures. */
  projectsDir = PROJECTS_DIR()
): Promise<TicketContext> {
  const [evidence, notes] = await Promise.all([
    evidenceFor(workspace, ticket, prNumbers),
    ticket ? notesFor(ticket, projectsDir) : []
  ])
  return { evidence, notes }
}

/**
 * Whether a path may be opened from the context panel: a folder in the
 * project's context folder (opens in Finder) or a memory note (.md, opens in
 * the default editor).
 * Nothing else, so a click can never launch a program.
 */
export async function openablePath(
  workspace: string | null,
  path: string,
  projectsDir = PROJECTS_DIR()
): Promise<'folder' | 'note' | null> {
  const real = await fs.realpath(path).catch(() => null)
  if (!real) return null
  const folder = projectConfig().contextFolder
  const evidenceRoot = workspace && folder ? ((await fs.realpath(join(workspace, folder)).catch(() => null)) ?? '') : ''
  const st = await fs.stat(real)
  if (evidenceRoot && st.isDirectory() && real.startsWith(evidenceRoot + sep)) return 'folder'
  const projects = await fs.realpath(projectsDir).catch(() => projectsDir)
  if (st.isFile() && real.endsWith('.md') && real.startsWith(projects + sep) && real.split(sep).includes('memory')) return 'note'
  return null
}
