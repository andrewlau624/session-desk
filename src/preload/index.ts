import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DeskApi } from '../shared/types'

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DeskApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  defaultCwd: () => ipcRenderer.invoke('sessions:defaultCwd'),
  ptyStart: (req) => ipcRenderer.invoke('pty:start', req),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.invoke('pty:kill', id),
  ptyStop: (id) => ipcRenderer.invoke('pty:stop', id),
  setSessionLaunch: (id, choice) => ipcRenderer.invoke('session:setLaunch', id, choice),
  openFolder: (id, how) => ipcRenderer.invoke('folder:open', id, how),
  folderApps: () => ipcRenderer.invoke('folder:apps'),
  modelCatalog: () => ipcRenderer.invoke('models:catalog'),
  listBranches: () => ipcRenderer.invoke('branches:list'),
  removeBranch: (repoPath, branch) => ipcRenderer.invoke('branches:remove', repoPath, branch),
  ticketBranches: (ticket, prHeads) => ipcRenderer.invoke('worktrees:forTicket', ticket, prHeads),
  ptyKickoff: (id, ticket, kind, prBranch) => ipcRenderer.invoke('pty:kickoff', id, ticket, kind, prBranch),
  onPtyData: (cb) => subscribe('pty:data', cb),
  onPtyExit: (cb) => subscribe('pty:exit', cb),
  onSessionsChanged: (cb) => subscribe('sessions:changed', cb),
  linkSession: (id, ticket) => ipcRenderer.invoke('sessions:link', id, ticket),
  renameSession: (id, name) => ipcRenderer.invoke('sessions:rename', id, name),
  archiveSession: (id, archived) => ipcRenderer.invoke('sessions:archive', id, archived),
  revealTranscript: (id) => ipcRenderer.invoke('sessions:reveal', id),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  moveSession: (id, groupId) => ipcRenderer.invoke('sessions:move', id, groupId),
  listGroups: () => ipcRenderer.invoke('groups:list'),
  createGroup: (name) => ipcRenderer.invoke('groups:create', name),
  renameGroup: (id, name) => ipcRenderer.invoke('groups:rename', id, name),
  deleteGroup: (id) => ipcRenderer.invoke('groups:delete', id),
  setGroupCollapsed: (id, collapsed) => ipcRenderer.invoke('groups:collapse', id, collapsed),
  pinSession: (id, pinned) => ipcRenderer.invoke('sessions:pin', id, pinned),
  listCollapsedProjects: () => ipcRenderer.invoke('projects:collapsed'),
  setProjectCollapsed: (path, collapsed) => ipcRenderer.invoke('projects:collapse', path, collapsed),
  openInTerminal: (id) => ipcRenderer.invoke('sessions:openInTerminal', id),
  linearStatus: () => ipcRenderer.invoke('linear:status'),
  linearSetKey: (key) => ipcRenderer.invoke('linear:setKey', key),
  getBoard: () => ipcRenderer.invoke('linear:board'),
  getIssue: (identifier) => ipcRenderer.invoke('linear:issue', identifier),
  requestGreptileReview: (url) => ipcRenderer.invoke('pr:greptile', url),
  ticketContext: (ticket, prNumbers) => ipcRenderer.invoke('context:get', ticket, prNumbers),
  searchTranscripts: (query) => ipcRenderer.invoke('search:transcripts', query),
  listArtifacts: () => ipcRenderer.invoke('artifacts:list'),
  setArtifactHidden: (url, hidden) => ipcRenderer.invoke('artifacts:hide', url, hidden),
  openContextPath: (path) => ipcRenderer.invoke('context:open', path),
  moveCard: (identifier, column) => ipcRenderer.invoke('linear:move', identifier, column),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  listWorktrees: () => ipcRenderer.invoke('worktrees:list'),
  removeWorktree: (path, deleteBranch) => ipcRenderer.invoke('worktrees:remove', path, deleteBranch),
  pruneWorktrees: (repoPath) => ipcRenderer.invoke('worktrees:prune', repoPath),
  setActiveSession: (id) => ipcRenderer.send('ui:active', id),
  onNavigateToSession: (cb) => subscribe('nav:session', cb),
  onNotice: (cb) => subscribe('notice', cb),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  hookStatus: () => ipcRenderer.invoke('hook:status'),
  hookPreview: (action) => ipcRenderer.invoke('hook:preview', action),
  hookApply: (action) => ipcRenderer.invoke('hook:apply', action),
  pickFolder: (key) => ipcRenderer.invoke('settings:pick', key),
  resetFolder: (key) => ipcRenderer.invoke('settings:reset', key),
  onSettingsChanged: (cb) => subscribe('settings:changed', cb),
  createProjectConfig: () => ipcRenderer.invoke('project:createConfig'),
  openProjectConfig: () => ipcRenderer.invoke('project:openConfig'),
  onOpenSettings: (cb) => subscribe('ui:open-settings', cb)
}

contextBridge.exposeInMainWorld('desk', api)
