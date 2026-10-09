import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tmp } from './helpers'

// `claude --version`, faked.
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, out: string) => void) => cb(null, '2.1.290 (Claude Code)\n')
}))
vi.mock('../src/main/env', () => ({ loginPath: async () => '/usr/bin:/bin' }))

const { parseCatalog, readModelCatalog, versionAtLeast, builtInCatalog } = await import('../src/main/modelCatalog')
const { pickerMenus } = await import('../src/renderer/src/components/ModelPicker')

// Shaped like Claude Code's cache/model-catalog/<…>-cc.json (version 2), trimmed.
const effort = (ids: string[]) => ({
  type: 'effort',
  description: 'Higher effort…',
  effort_options: ids.map((id) => ({ id, name: id === 'xhigh' ? 'Extra' : id[0].toUpperCase() + id.slice(1), ...(id === 'medium' ? { badge: { message: 'Recommended', variant: 'neutral' } } : {}) }))
})
const catalogFile = (models: object[]) => ({
  version: 2,
  fetchedAt: 1791575159763,
  staleAt: 1791578831493,
  catalog: { surface: 'cc', config: { id: 'x', models, settings_vocabulary: {} }, state: { model: 'claude-haiku-5-5', selection_source: 'user_setting' } }
})
const MODELS = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', section: 'main', thinking: effort(['low', 'medium', 'high', 'xhigh', 'max']), min_claude_code_version: '2.1.280' },
  { id: 'claude-fable-5-1', name: 'Fable 5.1', section: 'main', thinking: effort(['low', 'medium', 'high']), notice: { text: 'Draws down usage faster' } },
  { id: 'claude-next-6', name: 'Next 6', section: 'main', thinking: effort(['high']), min_claude_code_version: '2.1.300' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', section: 'overflow', thinking: { type: 'none' } },
  { id: 'bad id!', name: 'x', section: 'main' }
]

describe("Claude Code's model catalog", () => {
  it('reads models, sections, per-model efforts with badges, notices and version floors', () => {
    const models = parseCatalog(catalogFile(MODELS))!
    expect(models.map((m) => [m.id, m.section])).toEqual([
      ['claude-opus-5-5', 'main'],
      ['claude-fable-5-1', 'main'],
      ['claude-next-6', 'main'],
      ['claude-haiku-4-5-20251001', 'overflow']
    ])
    expect(models[0].efforts?.find((e) => e.id === 'medium')).toEqual({ id: 'medium', name: 'Medium', badge: 'Recommended' })
    expect(models[0].efforts?.find((e) => e.id === 'xhigh')?.name).toBe('Extra')
    expect(models[1].notice).toBe('Draws down usage faster')
    // No effort options at all.
    expect(models[3].efforts).toBeNull()
  })

  it('rejects a file that is not a catalog', () => {
    expect(parseCatalog({})).toBeNull()
    expect(parseCatalog({ catalog: { config: { models: 'nope' } } })).toBeNull()
    expect(parseCatalog(catalogFile([]))).toBeNull()
  })

  it("prefers the CLI's catalog, skips models newer than the installed CLI, and falls back to the built-in list", async () => {
    const dir = join(tmp(), 'model-catalog')
    mkdirSync(dir)
    writeFileSync(join(dir, 'acct-ccd.json'), JSON.stringify(catalogFile([MODELS[0]])))
    writeFileSync(join(dir, 'acct-cc.json'), JSON.stringify(catalogFile(MODELS)))
    const c = await readModelCatalog(dir)
    expect(c.source).toBe('claude-code')
    expect(c.models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001'])

    writeFileSync(join(dir, 'acct-cc.json'), '{ half-written')
    expect((await readModelCatalog(dir)).models.map((m) => m.id)).toEqual(['claude-opus-5-5'])

    const empty = join(tmp(), 'none')
    expect(await readModelCatalog(empty)).toEqual(builtInCatalog())
  })

  it('versionAtLeast', () => {
    expect(versionAtLeast('2.1.295', '2.1.280')).toBe(true)
    expect(versionAtLeast('2.1.295', '2.1.300')).toBe(false)
    expect(versionAtLeast('2.2.0', '2.1.300')).toBe(true)
  })
})

describe('the picker menus from the catalog', () => {
  const catalog = { source: 'claude-code' as const, fetchedAt: 1, models: parseCatalog(catalogFile(MODELS))! }
  const label = (e: unknown) => (e === 'divider' ? '—' : (e as { heading?: string; note?: string }).heading ?? (e as { note?: string }).note ?? (e as { label: string }).label)

  it('main models, then More models; the current one ticked even when its ID has a date', () => {
    const m = pickerMenus(catalog, { modelId: 'claude-haiku-4-5', effort: null }, null, () => {})
    expect(m.models.map(label)).toEqual(['Opus 5.5', 'Fable 5.1', 'Next 6', '—', 'More models', '—', 'For this session only; restarts it'])
    const more = (m.models[4] as { submenu: { label: string; checked?: boolean }[] }).submenu
    expect(more).toMatchObject([{ label: 'Haiku 4.5', checked: true }])
    expect(m.modelName).toBe('Haiku 4.5')
    // Haiku 4.5 has no effort levels: no effort menu.
    expect(m.efforts).toBeNull()
  })

  it("the current model's own efforts, with badges", () => {
    const m = pickerMenus(catalog, { modelId: 'claude-fable-5-1', effort: 'medium' }, null, () => {})
    expect(m.efforts!.slice(0, 3)).toMatchObject([{ label: 'Low' }, { label: 'Medium', hint: 'Recommended', checked: true }, { label: 'High' }])
    expect(m.effortName).toBe('Medium')
  })
})
