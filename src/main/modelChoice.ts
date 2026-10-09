import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { claudeDir } from './paths'

/** Your default model from Claude Code's settings (e.g. opus[1m]); null when unset or unreadable. */
export async function defaultModel(): Promise<string | null> {
  try {
    const s = JSON.parse(await fs.readFile(join(claudeDir(), 'settings.json'), 'utf8'))
    return typeof s.model === 'string' ? s.model : null
  } catch {
    return null
  }
}

/**
 * The chosen model, keeping a 1M context your default has: picking Opus 5.5
 * when the default is opus[1m] gives claude-opus-5-5[1m], so switching
 * versions doesn't silently shrink the context. Other families run as chosen.
 */
export function withDefaultContext(model: string, fallback: string | null): string {
  if (!fallback?.endsWith('[1m]') || model.endsWith('[1m]')) return model
  const family = (m: string) => /^(?:claude-)?([a-z]+)/.exec(m)?.[1]
  return family(model) === family(fallback) ? `${model}[1m]` : model
}
