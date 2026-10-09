import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { HookStatus } from '../shared/types'
import { hookState, withHooks, withoutHooks } from './hookSettings'
import { claudeDir } from './paths'

/** The hook script as shipped: in the app bundle, or the repo when running from source. */
function bundledScript(): string {
  return app.isPackaged ? join(process.resourcesPath, 'status-hook.sh') : join(app.getAppPath(), 'hooks', 'status-hook.sh')
}

const installedScript = () => join(homedir(), '.session-desk', 'hook.sh')
const settingsPath = () => join(claudeDir(), 'settings.json')

async function readSettings(): Promise<{ text: string; json: any }> {
  const text = await fs.readFile(settingsPath(), 'utf8').catch(() => '{}\n')
  try {
    return { text, json: JSON.parse(text) }
  } catch {
    throw new Error(`${settingsPath()} isn't valid JSON; fix it before installing.`)
  }
}

export async function hookStatus(): Promise<HookStatus> {
  const { json } = await readSettings()
  const state = hookState(json)
  const [want, have] = await Promise.all([
    fs.readFile(bundledScript(), 'utf8').catch(() => null),
    fs.readFile(installedScript(), 'utf8').catch(() => null)
  ])
  return {
    settingsPath: settingsPath(),
    state: state === 'installed' && want !== null && have !== want ? 'outdated' : state
  }
}

/** The exact change to settings.json, as a unified diff. */
export async function hookPreview(action: 'install' | 'uninstall'): Promise<string> {
  const { text, json } = await readSettings()
  const next = JSON.stringify(action === 'install' ? withHooks(json) : withoutHooks(json), null, 2) + '\n'
  if (next === text) return ''
  const tmp = join(tmpdir(), `session-desk-settings.${process.pid}.json`)
  await fs.writeFile(tmp, next)
  const before = join(tmpdir(), `session-desk-settings.${process.pid}.before.json`)
  await fs.writeFile(before, text)
  const out = await new Promise<string>((resolve) =>
    execFile('diff', ['-u', '--label', 'settings.json (now)', '--label', 'settings.json (after)', before, tmp], (_e, stdout) => resolve(String(stdout)))
  )
  await Promise.all([fs.rm(tmp, { force: true }), fs.rm(before, { force: true })])
  return out
}

/** Backs settings.json up, writes the change, and installs (or leaves) the script. */
export async function hookApply(action: 'install' | 'uninstall'): Promise<HookStatus> {
  const path = settingsPath()
  const { text, json } = await readSettings()
  const next = JSON.stringify(action === 'install' ? withHooks(json) : withoutHooks(json), null, 2) + '\n'
  if (next !== text) {
    await fs.mkdir(claudeDir(), { recursive: true })
    const exists = await fs.stat(path).then(() => true, () => false)
    if (exists) await fs.copyFile(path, `${path}.session-desk-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    const tmp = `${path}.session-desk-tmp`
    await fs.writeFile(tmp, next)
    await fs.rename(tmp, path)
  }
  if (action === 'install') {
    await fs.mkdir(join(homedir(), '.session-desk'), { recursive: true })
    await fs.copyFile(bundledScript(), installedScript())
    await fs.chmod(installedScript(), 0o755)
  }
  return hookStatus()
}
