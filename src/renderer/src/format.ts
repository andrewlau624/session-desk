// The connected Linear workspace's URL key (linear.app/<key>), from Linear itself.
let workspaceKey: string | null = null

export function setLinearWorkspaceKey(key: string | null): void {
  workspaceKey = key
}

/** A ticket's Linear page, or null until the workspace is known (better no link than a wrong one). */
export function linearUrl(ticket: string): string | null {
  return workspaceKey ? `https://linear.app/${workspaceKey}/issue/${ticket}` : null
}

export function linearSettingsUrl(): string {
  return workspaceKey ? `https://linear.app/${workspaceKey}/settings/account/security` : 'https://linear.app/settings/account/security'
}

export function timeAgo(ms: number): string {
  if (!ms) return ''
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

/** Message from a failed IPC call, without Electron's "Error invoking remote method" wrapper. */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function folderName(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || p
}
