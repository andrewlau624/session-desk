// Characters a shell would read specially in a path, escaped with a backslash
// the way Terminal.app does when a file is dropped on it. Claude Code reads a
// pasted path written like this as a file, and attaches it when it's an image.
const SHELL_SPECIAL = /[\s\\'"`$&|;<>()[\]{}*?!#~^=%,]/g

/** One dropped path, escaped as Terminal.app would type it. */
export function quotePath(path: string): string {
  return path.replace(SHELL_SPECIAL, '\\$&')
}

/** The text a drop types into the prompt: the paths, space-separated, with a trailing space. Empty if none. */
export function dropText(paths: string[]): string {
  const kept = paths.filter((p) => p !== '')
  return kept.length ? kept.map(quotePath).join(' ') + ' ' : ''
}

/** Whether a drag carries files from Finder (as opposed to text or a dragged board card). */
export function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files')
}
