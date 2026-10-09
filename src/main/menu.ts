import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { linearHandlesReview, linearOwnRules } from './autoRunner'
import { basename } from 'node:path'
import { store } from './store'

/** Project switching lives in index.ts (it re-points watchers); the menu just calls it. */
let projectActions: { choose: () => void; open: (path: string) => void } = { choose: () => {}, open: () => {} }
export function setProjectActions(actions: typeof projectActions): void {
  projectActions = actions
}

/**
 * The macOS menu bar. Setting any menu replaces Electron's default, so the
 * standard Edit and Window menus are rebuilt here; without Edit, copy and
 * paste stop working in text fields.
 */
export function installMenu(): void {
  const prefs = store.prefs()
  const auto = store.autoSince()
  const reviewByLinear = linearHandlesReview()
  const own = linearOwnRules()
  const rebuild = () => installMenu()
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => BrowserWindow.getAllWindows()[0]?.webContents.send('ui:open-settings')
        },
        { type: 'separator' },
        {
          label: app.isPackaged ? 'Open at Login' : 'Open at Login (installed app only)',
          type: 'checkbox',
          // In dev this would register the Electron binary itself.
          enabled: app.isPackaged,
          checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked })
            rebuild()
          }
        },
        { type: 'separator' },
        {
          label: 'Notify When a Session Needs You',
          type: 'checkbox',
          checked: prefs.notify,
          click: (item) => store.setPref('notify', item.checked).then(rebuild)
        },
        {
          label: 'Include Sessions Open in Other Apps',
          type: 'checkbox',
          enabled: prefs.notify,
          checked: prefs.notifyElsewhere,
          click: (item) => store.setPref('notifyElsewhere', item.checked).then(rebuild)
        },
        { type: 'separator' },
        {
          label: 'Linear Automation',
          submenu: [
            { label: 'These change tickets on your team’s board.', enabled: false },
            { type: 'separator' },
            {
              label: 'To Do → In Progress When a Session Starts Working',
              type: 'checkbox',
              checked: !!auto.start,
              click: (item) => store.setAutoRule('start', item.checked).then(rebuild)
            },
            reviewByLinear
              ? { label: `In Review on PR Open: Linear already does this (→ ${reviewByLinear})`, enabled: false }
              : {
                  label: 'In Progress → In Review When a PR Opens',
                  type: 'checkbox',
                  checked: !!auto.review,
                  click: (item) => store.setAutoRule('review', item.checked).then(rebuild)
                },
            ...(own.length
              ? [
                  { type: 'separator' as const },
                  { label: 'Linear’s own rules for this team:', enabled: false },
                  ...own.map((r) => ({ label: `   PR ${r.event} → ${r.state}`, enabled: false }))
                ]
              : [])
          ]
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Switch Project…', accelerator: 'CmdOrCtrl+Shift+O', click: () => projectActions.choose() },
        {
          label: 'Recent Projects',
          submenu: store.recentWorkspaces().length
            ? store.recentWorkspaces().map((p) => ({
                label: `${basename(p)}  —  ${p.replace(app.getPath('home'), '~')}`,
                type: 'checkbox' as const,
                checked: p === store.paths().workspace,
                click: () => projectActions.open(p)
              }))
            : [{ label: 'None yet', enabled: false }]
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
