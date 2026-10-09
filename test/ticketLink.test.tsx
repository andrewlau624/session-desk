import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TicketLink } from '../src/renderer/src/components/links'
import { linearUrl, setLinearWorkspaceKey } from '../src/renderer/src/format'

describe('ticket links', () => {
  it('link to the connected workspace, and are plain text until it is known', () => {
    setLinearWorkspaceKey(null)
    expect(linearUrl('ENG-1')).toBeNull()
    expect(renderToStaticMarkup(<TicketLink ticket="ENG-8812" />)).toBe('<span>ENG-8812</span>')
    setLinearWorkspaceKey('acme')
    expect(linearUrl('ENG-12')).toBe('https://linear.app/acme/issue/ENG-12')
    expect(renderToStaticMarkup(<TicketLink ticket="ENG-12" />)).toContain('href="https://linear.app/acme/issue/ENG-12"')
    // Linear's own issue URL wins when there is one.
    expect(renderToStaticMarkup(<TicketLink ticket="ENG-12" url="https://linear.app/acme/issue/ENG-12/title" />)).toContain('/ENG-12/title')
  })
})
