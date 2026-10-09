import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { EFFORT_CHOICES, MODEL_CHOICES, MORE_MODEL_CHOICES, type CatalogModel, type ModelCatalog } from '../shared/types'
import { loginPath } from './env'
import { claudeDir } from './paths'

/**
 * The models Claude Code offers this account, from the catalog it fetches
 * from Anthropic and caches (about hourly) in <claude dir>/cache/model-catalog:
 * `-cc` for the CLI, `-ccd` for the desktop app. It's an internal cache, not
 * an API, so its shape is checked and anything unexpected falls back to the
 * built-in list. Only `config.models` is used: `state` records whatever ran
 * last, not your default.
 */
export function parseCatalog(raw: unknown): CatalogModel[] | null {
  const models = (raw as { catalog?: { config?: { models?: unknown } } })?.catalog?.config?.models
  if (!Array.isArray(models)) return null
  const out: CatalogModel[] = []
  for (const m of models) {
    if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || !/^[\w.-]+$/.test(m.id)) continue
    const options = m.thinking?.type === 'effort' && Array.isArray(m.thinking.effort_options) ? m.thinking.effort_options : null
    const efforts = options
      ?.filter((o: { id?: unknown; name?: unknown }) => typeof o?.id === 'string' && typeof o?.name === 'string')
      .map((o: { id: string; name: string; badge?: { message?: unknown } }) => ({
        id: o.id,
        name: o.name,
        ...(typeof o.badge?.message === 'string' ? { badge: o.badge.message } : {})
      }))
    out.push({
      id: m.id,
      name: m.name,
      section: m.section === 'overflow' ? 'overflow' : 'main',
      efforts: efforts?.length ? efforts : null,
      ...(typeof m.notice?.text === 'string' ? { notice: m.notice.text } : {}),
      ...(typeof m.min_claude_code_version === 'string' ? { minVersion: m.min_claude_code_version } : {})
    })
  }
  return out.length ? out : null
}

/** a >= b for dotted versions like 2.1.295. */
export function versionAtLeast(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0
  }
  return true
}

/** Used when no catalog can be read: the list as of this app's release. */
export function builtInCatalog(): ModelCatalog {
  const efforts = EFFORT_CHOICES.map((e) => ({ id: e.level, name: e.label }))
  return {
    source: 'built-in',
    fetchedAt: null,
    models: [
      ...MODEL_CHOICES.map((m) => ({ id: m.id, name: m.label, section: 'main' as const, efforts })),
      ...MORE_MODEL_CHOICES.map((m) => ({ id: m.id, name: m.label, section: 'overflow' as const, efforts }))
    ]
  }
}

let cliVersion: Promise<string | null> | null = null
/** The installed Claude Code version (asked once), to hide models it's too old for. */
function installedCli(): Promise<string | null> {
  cliVersion ??= loginPath().then(
    (PATH) =>
      new Promise((resolve) =>
        execFile('claude', ['--version'], { env: { ...process.env, PATH }, timeout: 10_000 }, (err, out) =>
          resolve(err ? null : (/(\d+\.\d+\.\d+)/.exec(String(out))?.[1] ?? null))
        )
      )
  )
  return cliVersion
}

export async function readModelCatalog(dir = join(claudeDir(), 'cache', 'model-catalog')): Promise<ModelCatalog> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  // The CLI's own catalog is what a session runs with; the desktop app's will do otherwise.
  const files = await Promise.all(
    names
      .filter((n) => n.endsWith('.json'))
      .map(async (n) => ({ n, mtime: (await fs.stat(join(dir, n)).catch(() => null))?.mtimeMs ?? 0 }))
  )
  const ordered = files.sort((a, b) => Number(b.n.endsWith('-cc.json')) - Number(a.n.endsWith('-cc.json')) || b.mtime - a.mtime)
  for (const { n } of ordered) {
    try {
      const raw = JSON.parse(await fs.readFile(join(dir, n), 'utf8'))
      const models = parseCatalog(raw)
      if (!models) continue
      const cli = await installedCli()
      return {
        source: 'claude-code',
        fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null,
        models: cli ? models.filter((m) => !m.minVersion || versionAtLeast(cli, m.minVersion)) : models
      }
    } catch {
      // Mid-write or unreadable: try the next one.
    }
  }
  return builtInCatalog()
}
