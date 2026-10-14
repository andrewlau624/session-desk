import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app, safeStorage } from 'electron'
import type { LinearWorkspace, SessionGroup, SessionLaunch } from '../shared/types'

/** App-owned state. Nothing here is written back to Claude Code's own files. */
interface Data {
  /** sessionId -> ticket, set by hand or when a session is started from a board card. */
  links: Record<string, string>
  /**
   * Tickets dragged into Waiting Response by hand, with when (Unix seconds).
   * Linear itself stays In Progress. Older files stored `true`.
   */
  waiting: Record<string, number | true>
  /** Sessions hidden from the main sidebar list. */
  archived: Record<string, true>
  /** Custom sidebar groups, in display order. */
  groups: SessionGroup[]
  /** sessionId -> groupId. */
  membership: Record<string, string>
  pinned: Record<string, true>
  /** sessionId -> the model/effort chosen for it in the app (passed as flags; your defaults stay). */
  sessionLaunch?: Record<string, SessionLaunch>
  /** sessionId -> what the app did about its pin as its ticket moved (see autoPin.ts). */
  autoPin: Record<string, AutoPin>
  /** Project-folder sections collapsed in the sidebar, by folder path. */
  collapsedProjects: Record<string, true>
  prefs: Prefs
  /** When each automatic Linear rule was turned on (ms); absent = off. */
  autoSince: Partial<Record<'start' | 'review', number>>
  /** `${ticket}|${rule}` -> when the app moved it; each rule moves a ticket once. */
  autoDone: Record<string, number>
  /** Artifact links removed from the Artifacts list (app-side only). */
  hiddenArtifacts: Record<string, true>
  /** Folders chosen in Settings; unset means the default. */
  paths: { workspace?: string; claudeDir?: string }
  /** Project folders used before, most recent first (for Switch Project). */
  recentWorkspaces?: string[]
  /**
   * Linear per project folder ('' when none is chosen): the personal API key,
   * encrypted with a Keychain-held key (base64), and the workspace it last
   * reached (URL key and team ticket prefixes), for links and offline use.
   */
  linearByProject?: Record<string, { key?: string; workspace?: LinearWorkspace }>
  /** Before Linear was per project: the one key and workspace. Moved into linearByProject. */
  linearWorkspace?: LinearWorkspace
  linearKey?: string
}

const path = () => join(app.getPath('userData'), 'session-desk.json')

let data: Data | null = null

export type AutoPin = 'pinned' | 'kept' | 'unpinned'

export interface Prefs {
  /** Notify when a session starts waiting on you. */
  notify: boolean
  /** Also for sessions open in Claude desktop or a terminal (they notify on their own). */
  notifyElsewhere: boolean
  /** Hide the NerfGuard button while NerfGuard isn't installed. */
  hideNerfguardWhenMissing: boolean
  /** Time frames with Chromium's own clock, not the display's (read at launch; see index.ts). */
  drawForScreenSharing: boolean
}

const DEFAULT_PREFS: Prefs = { notify: true, notifyElsewhere: false, hideNerfguardWhenMissing: false, drawForScreenSharing: false }

const empty = (): Data => ({
  links: {},
  waiting: {},
  archived: {},
  groups: [],
  membership: {},
  pinned: {},
  autoPin: {},
  collapsedProjects: {},
  prefs: { ...DEFAULT_PREFS },
  autoSince: {},
  autoDone: {},
  hiddenArtifacts: {},
  paths: {}
})

function load(): Data {
  if (data) return data
  try {
    data = { ...empty(), ...JSON.parse(readFileSync(path(), 'utf8')) }
  } catch {
    data = empty()
  }
  return data!
}

let writing = Promise.resolve()

function save(): Promise<void> {
  // Serialise writes and replace atomically so a crash never leaves half a file.
  const snapshot = JSON.stringify(load(), null, 2)
  writing = writing.then(async () => {
    const tmp = `${path()}.tmp`
    await fs.writeFile(tmp, snapshot, { mode: 0o600 })
    await fs.rename(tmp, path())
  })
  return writing
}

export const store = {
  links: () => load().links,
  setLink(sessionId: string, ticket: string | null) {
    const d = load()
    if (ticket) d.links[sessionId] = ticket
    else delete d.links[sessionId]
    return save()
  },

  isArchived: (sessionId: string) => !!load().archived[sessionId],
  setArchived(sessionId: string, on: boolean) {
    const d = load()
    if (on) d.archived[sessionId] = true
    else delete d.archived[sessionId]
    return save()
  },

  groups: () => load().groups,
  groupOf(sessionId: string): string | null {
    const g = load().membership[sessionId]
    // Membership can outlive a group only if the file was edited by hand.
    return g && load().groups.some((x) => x.id === g) ? g : null
  },
  createGroup(name: string): Promise<SessionGroup> {
    const group: SessionGroup = { id: randomUUID(), name, collapsed: false }
    load().groups.push(group)
    return save().then(() => group)
  },
  updateGroup(id: string, patch: Partial<Pick<SessionGroup, 'name' | 'collapsed'>>) {
    const g = load().groups.find((x) => x.id === id)
    if (!g) throw new Error('Group not found')
    Object.assign(g, patch)
    return save()
  },
  deleteGroup(id: string) {
    const d = load()
    d.groups = d.groups.filter((g) => g.id !== id)
    for (const [sid, gid] of Object.entries(d.membership)) if (gid === id) delete d.membership[sid]
    return save()
  },
  moveSession(sessionId: string, groupId: string | null) {
    const d = load()
    if (groupId && !d.groups.some((g) => g.id === groupId)) throw new Error('Group not found')
    if (groupId) d.membership[sessionId] = groupId
    else delete d.membership[sessionId]
    return save()
  },
  /** Drops everything the app remembers about a deleted session. */
  forgetSession(sessionId: string) {
    const d = load()
    delete d.links[sessionId]
    delete d.archived[sessionId]
    delete d.membership[sessionId]
    delete d.pinned[sessionId]
    delete d.autoPin[sessionId]
    if (d.sessionLaunch) delete d.sessionLaunch[sessionId]
    return save()
  },

  sessionLaunch: (sessionId: string): SessionLaunch | null => load().sessionLaunch?.[sessionId] ?? null,
  setSessionLaunch(sessionId: string, choice: { model?: string; effort?: string; permissionMode?: 'bypassPermissions' }) {
    const d = load()
    const prev = d.sessionLaunch?.[sessionId]
    d.sessionLaunch = { ...d.sessionLaunch, [sessionId]: { ...prev, ...choice, at: Date.now() } }
    return save()
  },

  autoPinOf: (sessionId: string): AutoPin | undefined => load().autoPin[sessionId],
  setAutoPin(sessionId: string, record: AutoPin) {
    const d = load()
    if (d.autoPin[sessionId] === record) return Promise.resolve()
    d.autoPin[sessionId] = record
    return save()
  },

  isPinned: (sessionId: string) => !!load().pinned[sessionId],
  setPinned(sessionId: string, on: boolean) {
    const d = load()
    if (on) d.pinned[sessionId] = true
    else delete d.pinned[sessionId]
    return save()
  },

  collapsedProjects: () => Object.keys(load().collapsedProjects),
  setProjectCollapsed(path: string, on: boolean) {
    const d = load()
    if (on) d.collapsedProjects[path] = true
    else delete d.collapsedProjects[path]
    return save()
  },

  prefs: (): Prefs => ({ ...DEFAULT_PREFS, ...load().prefs }),
  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const d = load()
    d.prefs = { ...DEFAULT_PREFS, ...d.prefs, [key]: value }
    return save()
  },

  autoSince: () => ({ ...load().autoSince }),
  setAutoRule(rule: 'start' | 'review', on: boolean) {
    const d = load()
    d.autoSince = { ...d.autoSince }
    if (on) d.autoSince[rule] = Date.now()
    else delete d.autoSince[rule]
    return save()
  },
  autoDone: (ticket: string, rule: 'start' | 'review') => !!load().autoDone?.[`${ticket}|${rule}`],
  markAutoDone(ticket: string, rule: 'start' | 'review') {
    const d = load()
    d.autoDone = { ...d.autoDone, [`${ticket}|${rule}`]: Date.now() }
    return save()
  },

  linearWorkspace: (project: string | null): LinearWorkspace | undefined => load().linearByProject?.[project ?? '']?.workspace,
  setLinearWorkspace(project: string | null, w: LinearWorkspace) {
    const d = load()
    const all = (d.linearByProject ??= {})
    all[project ?? ''] = { ...all[project ?? ''], workspace: w }
    return save()
  },
  /** Hands the old app-wide Linear connection to this project (once). */
  adoptLegacyLinear(project: string | null) {
    const d = load()
    if (!d.linearKey && !d.linearWorkspace) return Promise.resolve()
    const all = (d.linearByProject ??= {})
    const slot = (all[project ?? ''] ??= {})
    slot.key ??= d.linearKey
    slot.workspace ??= d.linearWorkspace
    delete d.linearKey
    delete d.linearWorkspace
    return save()
  },

  paths: () => ({ ...load().paths }),
  setPath(key: 'workspace' | 'claudeDir', value: string | null) {
    const d = load()
    d.paths = { ...d.paths }
    if (value) d.paths[key] = value
    else delete d.paths[key]
    if (key === 'workspace' && value) d.recentWorkspaces = [value, ...(d.recentWorkspaces ?? []).filter((p) => p !== value)].slice(0, 8)
    return save()
  },
  recentWorkspaces: () => {
    // The current folder counts even if it was chosen before this list existed.
    const d = load()
    const list = d.recentWorkspaces ?? []
    const current = d.paths.workspace
    return current && !list.includes(current) ? [current, ...list] : list
  },

  isArtifactHidden: (url: string) => !!load().hiddenArtifacts?.[url],
  setArtifactHidden(url: string, hidden: boolean) {
    const d = load()
    d.hiddenArtifacts = { ...d.hiddenArtifacts }
    if (hidden) d.hiddenArtifacts[url] = true
    else delete d.hiddenArtifacts[url]
    return save()
  },

  /** When the ticket was put in Waiting by hand (0 for legacy entries), or null. */
  waitingSince(ticket: string): number | null {
    const v = load().waiting[ticket]
    return v === undefined ? null : v === true ? 0 : v
  },
  setWaiting(ticket: string, on: boolean) {
    const d = load()
    if (on) d.waiting[ticket] = Math.floor(Date.now() / 1000)
    else delete d.waiting[ticket]
    return save()
  },

  linearKey(project: string | null): string | null {
    const enc = load().linearByProject?.[project ?? '']?.key
    if (!enc || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  },
  setLinearKey(project: string | null, key: string | null) {
    const d = load()
    const all = (d.linearByProject ??= {})
    const slot = (all[project ?? ''] ??= {})
    if (key) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Keychain encryption is unavailable')
      slot.key = safeStorage.encryptString(key).toString('base64')
    } else {
      delete slot.key
    }
    return save()
  }
}
