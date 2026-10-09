#!/usr/bin/env node
// Installs (or removes) the Session Desk status hook in ~/.claude/settings.json.
//
//   node scripts/install-hooks.mjs --dry-run    show the settings diff, change nothing
//   node scripts/install-hooks.mjs              install (backs settings.json up first)
//   node scripts/install-hooks.mjs --uninstall  remove our entries, keep everything else
//
// Our entries are recognised by their command path, so re-running is a no-op
// and other hooks (yours, plugins', project ones) are never touched.

import { execFileSync } from 'node:child_process'
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The rules live in one place, shared with the app (Node runs the TS directly).
import { withHooks, withoutHooks } from '../src/main/hookSettings.ts'

const SETTINGS = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json')
const HOOK_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'status-hook.sh')
const HOOK_DST = join(homedir(), '.session-desk', 'hook.sh')

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const uninstall = args.has('--uninstall')

const original = existsSync(SETTINGS) ? readFileSync(SETTINGS, 'utf8') : '{}\n'
const settings = uninstall ? withoutHooks(JSON.parse(original)) : withHooks(JSON.parse(original))

const updated = JSON.stringify(settings, null, 2) + '\n'

if (dryRun) {
  const tmp = join(tmpdir(), `settings.proposed.${process.pid}.json`)
  writeFileSync(tmp, updated)
  try {
    execFileSync('diff', ['-u', '--label', SETTINGS + ' (current)', '--label', SETTINGS + ' (proposed)', SETTINGS, tmp], {
      stdio: 'inherit'
    })
    console.log('No changes.')
  } catch {
    // diff exits 1 when the files differ; the diff itself was printed.
  }
  process.exit(0)
}

if (updated === original) {
  console.log('Already up to date.')
} else {
  const backup = `${SETTINGS}.session-desk-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, backup)
  writeFileSync(SETTINGS, updated)
  console.log(`Updated ${SETTINGS}` + (existsSync(backup) ? ` (backup: ${backup})` : ''))
}

if (!uninstall) {
  mkdirSync(dirname(HOOK_DST), { recursive: true })
  copyFileSync(HOOK_SRC, HOOK_DST)
  chmodSync(HOOK_DST, 0o755)
  console.log(`Installed hook script at ${HOOK_DST}`)
}
