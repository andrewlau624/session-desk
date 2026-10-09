import { execFile } from 'node:child_process'

let pathPromise: Promise<string> | null = null

/**
 * PATH as the user's interactive login shell sets it. Apps launched from the
 * Dock get a bare PATH without Homebrew, so `gh` would not be found.
 */
export function loginPath(): Promise<string> {
  pathPromise ??= new Promise((resolve) => {
    // Markers fence off anything the rc files print.
    execFile(
      process.env.SHELL || '/bin/zsh',
      ['-ilc', 'printf "__PATH__%s__END__" "$PATH"'],
      { timeout: 10_000 },
      (_err, stdout) => {
        const m = /__PATH__(.*)__END__/.exec(stdout ?? '')
        resolve(m?.[1] || process.env.PATH || '/usr/bin:/bin')
      }
    )
  })
  return pathPromise
}
