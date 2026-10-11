import { describe, expect, it } from 'vitest'
import { dropText, hasFiles, quotePath } from '../src/renderer/src/dropPaths'

describe('typing dropped files into the prompt', () => {
  it('leaves a plain path alone', () => {
    expect(quotePath('/Users/me/shot.png')).toBe('/Users/me/shot.png')
  })

  it('escapes spaces and shell characters as Terminal.app does', () => {
    expect(quotePath("/Users/me/Screen Shot (1) it's $5.png")).toBe(
      "/Users/me/Screen\\ Shot\\ \\(1\\)\\ it\\'s\\ \\$5.png"
    )
  })

  it('joins several paths with spaces and ends with one, so you can keep typing', () => {
    expect(dropText(['/a/b.png', '/c d/e.pdf'])).toBe('/a/b.png /c\\ d/e.pdf ')
  })

  it('types nothing when no file had a path (e.g. an image dragged from a web page)', () => {
    expect(dropText([])).toBe('')
    expect(dropText(['', ''])).toBe('')
  })

  it('only treats file drags as drops for the terminal', () => {
    const dt = (types: string[]) => ({ types }) as unknown as DataTransfer
    expect(hasFiles(dt(['Files']))).toBe(true)
    expect(hasFiles(dt(['text/plain']))).toBe(false)
    expect(hasFiles(null)).toBe(false)
  })
})
