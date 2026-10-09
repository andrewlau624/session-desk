#!/usr/bin/env node
// Copies the built app to /Applications/Session Desk.app, or to ~/Applications
// when this user can't write /Applications (not an admin).
// Run via `npm run install-app`, which builds first.

import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAME = 'Session Desk.app'
const built = join('dist', 'mac-arm64', NAME)
const SYSTEM_APPS = '/Applications'
const USER_APPS = join(homedir(), 'Applications')
const writable = (dir) => {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}
const appsDir = writable(SYSTEM_APPS) ? SYSTEM_APPS : USER_APPS
const target = join(appsDir, NAME)
// A copy left in the other folder (say, from before installs went to /Applications):
// removed below so Spotlight and Launchpad find only one Session Desk.
const other = join(appsDir === SYSTEM_APPS ? USER_APPS : SYSTEM_APPS, NAME)

if (!existsSync(built)) {
  console.error(`No build at ${built}. Run \`npm run dist\` first.`)
  process.exit(1)
}

// Replacing a running app's bundle out from under it breaks it.
const runningFrom = (app) => {
  try {
    return execFileSync('pgrep', ['-f', `${app}/Contents/MacOS/`], { encoding: 'utf8' }).trim() !== ''
  } catch {
    return false
  }
}
for (const app of [target, other]) {
  if (existsSync(app) && runningFrom(app)) {
    console.error(`Session Desk is running from ${app}. Quit it (⌘Q), then run this again.`)
    process.exit(1)
  }
}

// A stable signing identity keeps the app's code identity the same across
// builds, so macOS stops re-asking for Keychain access to the saved Linear
// key. Without one, the build keeps electron-builder's ad-hoc signature,
// which changes every time. Picked, in order: SESSION_DESK_SIGNING_IDENTITY,
// a "Developer ID Application" identity, a self-signed "Session Desk Local
// Signing" certificate.
const names = (() => {
  try {
    const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    return [...out.matchAll(/^\s*\d+\)\s+[0-9A-F]{40}\s+"([^"]+)"/gm)].map((m) => m[1])
  } catch {
    return []
  }
})()
const wanted = process.env.SESSION_DESK_SIGNING_IDENTITY
const identity = wanted
  ? names.find((n) => n === wanted)
  : (names.find((n) => n.startsWith('Developer ID Application:')) ?? names.find((n) => n === 'Session Desk Local Signing'))
if (wanted && !identity) {
  console.error(`No valid code-signing identity named "${wanted}".`)
  process.exit(1)
}
if (identity) {
  execFileSync('codesign', ['--force', '--deep', '--sign', identity, built], { stdio: 'inherit' })
  console.log(`Signed with "${identity}"`)
} else {
  console.log('No signing identity found; keeping the ad-hoc signature (macOS will re-ask for Keychain access).')
}

mkdirSync(appsDir, { recursive: true })
// Only ever the previous copy of this app.
if (existsSync(target) && target.endsWith(`/Applications/${NAME}`)) rmSync(target, { recursive: true })
// ditto keeps the bundle's signature and extended attributes intact.
execFileSync('ditto', [built, target])
execFileSync('codesign', ['--verify', '--deep', target])
console.log(`Installed ${target}`)
if (existsSync(other) && writable(join(other, '..'))) {
  rmSync(other, { recursive: true })
  console.log(`Removed the old copy at ${other}`)
}
