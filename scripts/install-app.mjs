#!/usr/bin/env node
// Copies the built app to ~/Applications/Session Desk.app: each macOS user
// installs their own copy, so one account's install never replaces another's.
// Run via `npm run install-app`, which builds first.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAME = 'Session Desk.app'
const built = join('dist', 'mac-arm64', NAME)
const appsDir = join(homedir(), 'Applications')
const target = join(appsDir, NAME)
// A copy this user once installed in /Applications: removed below so Spotlight
// and Launchpad find one Session Desk. Another user's copy there is theirs and
// is never touched.
const legacy = join('/Applications', NAME)
const mine = (app) => {
  try {
    return statSync(app).uid === process.getuid()
  } catch {
    return false
  }
}

if (!existsSync(built)) {
  console.error(`No build at ${built}. Run \`npm run dist\` first.`)
  process.exit(1)
}

// Replacing a running app's bundle out from under it breaks it. Only this
// user's processes count: another account may be running its own copy.
const runningFrom = (app) => {
  try {
    return execFileSync('pgrep', ['-U', String(process.getuid()), '-f', `${app}/Contents/MacOS/`], { encoding: 'utf8' }).trim() !== ''
  } catch {
    return false
  }
}
for (const app of [target, ...(mine(legacy) ? [legacy] : [])]) {
  if (existsSync(app) && runningFrom(app)) {
    console.error(`Session Desk is running from ${app}. Quit it (⌘Q), then run this again.`)
    process.exit(1)
  }
}

// A stable signing identity keeps the app's code identity the same across
// builds, so macOS stops re-asking for Keychain access to the saved Linear
// key. Without one, the build keeps electron-builder's ad-hoc signature,
// which changes every time, and also loses the app's macOS privacy grants
// (Documents folder access, which sessions in ~/Documents need). Picked, in
// order: SESSION_DESK_SIGNING_IDENTITY, a "Developer ID Application" identity,
// an "Apple Development" identity, a self-signed "Session Desk Local Signing"
// certificate.
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
  : (names.find((n) => n.startsWith('Developer ID Application:')) ??
    names.find((n) => n.startsWith('Apple Development:')) ??
    names.find((n) => n === 'Session Desk Local Signing'))
if (wanted && !identity) {
  console.error(`No valid code-signing identity named "${wanted}".`)
  process.exit(1)
}
if (identity) {
  execFileSync('codesign', ['--force', '--deep', '--sign', identity, built], { stdio: 'inherit' })
  console.log(`Signed with "${identity}"`)
} else {
  console.log('No signing identity found; keeping the ad-hoc signature (macOS will re-ask for Keychain access and Documents access).')
}

mkdirSync(appsDir, { recursive: true })
// Only ever the previous copy of this app.
if (existsSync(target) && target.endsWith(`/Applications/${NAME}`)) rmSync(target, { recursive: true })
// ditto keeps the bundle's signature and extended attributes intact.
execFileSync('ditto', [built, target])
execFileSync('codesign', ['--verify', '--deep', target])
console.log(`Installed ${target}`)
if (existsSync(legacy)) {
  if (mine(legacy)) {
    rmSync(legacy, { recursive: true })
    console.log(`Removed your old copy at ${legacy}`)
  } else {
    console.log(`Left ${legacy} alone: it belongs to another user`)
  }
}
