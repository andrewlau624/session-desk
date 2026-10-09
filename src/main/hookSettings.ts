// What the status hook adds to a Claude Code settings.json, and how to tell
// whether it's there. Pure (no imports), so both the app and
// scripts/install-hooks.mjs use it; keep it to type-only TypeScript so Node can
// run it directly.

/** Synchronous so state changes land in order (async hooks run in parallel). */
export const HOOK_COMMAND = '"$HOME/.session-desk/hook.sh"'
const HOOK = { type: 'command', command: HOOK_COMMAND, timeout: 5 }

/** Event -> matcher (null: the event takes no matcher). Measured on Claude Code 2.1.29x. */
export const HOOK_EVENTS: Record<string, string | null> = {
  UserPromptSubmit: null,
  PostToolUse: '*',
  PostToolUseFailure: '*',
  PermissionRequest: '*',
  Notification: 'permission_prompt|idle_prompt|agent_needs_input|elicitation_dialog',
  Stop: null,
  StopFailure: null,
  SessionEnd: null
}

export type HookSettings = { hooks?: Record<string, { matcher?: string; hooks?: { command?: string }[] }[]>; [k: string]: unknown }

/** Our entries are recognised by their command path; nothing else is ever touched. */
export const isOurs = (h: { command?: unknown } | undefined): boolean =>
  typeof h?.command === 'string' && h.command.includes('.session-desk/hook.sh')

/** The settings with our entries removed (and emptied events/hooks dropped). */
export function withoutHooks<T extends HookSettings>(settings: T): T {
  const s = structuredClone(settings)
  for (const [event, entries] of Object.entries(s.hooks ?? {})) {
    const kept = entries.map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !isOurs(h)) })).filter((e) => e.hooks.length > 0)
    if (kept.length) s.hooks![event] = kept
    else delete s.hooks![event]
  }
  if (s.hooks && Object.keys(s.hooks).length === 0) delete s.hooks
  return s
}

/** The settings with exactly one up-to-date copy of our entries. */
export function withHooks<T extends HookSettings>(settings: T): T & Required<Pick<HookSettings, 'hooks'>> {
  const s = withoutHooks(settings)
  s.hooks ??= {}
  for (const [event, matcher] of Object.entries(HOOK_EVENTS)) {
    const entry = matcher ? { matcher, hooks: [{ ...HOOK }] } : { hooks: [{ ...HOOK }] }
    s.hooks[event] = [...(s.hooks[event] ?? []), entry]
  }
  return s as T & Required<Pick<HookSettings, 'hooks'>>
}

/** installed: matches what withHooks writes. partial: some entries, or old ones. missing: none. */
export function hookState(settings: HookSettings): 'installed' | 'partial' | 'missing' {
  const any = Object.values(settings.hooks ?? {}).some((entries) => entries.some((e) => (e.hooks ?? []).some(isOurs)))
  if (!any) return 'missing'
  // Position doesn't matter (other hooks may come after ours); content does.
  const complete = Object.entries(HOOK_EVENTS).every(([event, matcher]) => {
    const ours = (settings.hooks?.[event] ?? []).filter((e) => (e.hooks ?? []).some(isOurs))
    if (ours.length !== 1) return false
    const h = (ours[0].hooks ?? []).find(isOurs) as { command?: string; timeout?: number; async?: boolean }
    return (ours[0].matcher ?? null) === matcher && h.command === HOOK_COMMAND && h.timeout === HOOK.timeout && !h.async
  })
  return complete ? 'installed' : 'partial'
}
