import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tmp } from './helpers'

const dir = tmp()
process.env.SESSION_DESK_TEST_USERDATA = dir
// A file from before prefs, groups and timestamped waiting flags existed.
writeFileSync(join(dir, 'session-desk.json'), JSON.stringify({ links: { a: 'ENG-1' }, waiting: { 'ENG-9': true }, archived: {} }))

const { store } = await import('../src/main/store')

describe('store', () => {
  it('reads older files: legacy waiting flags and missing sections', () => {
    expect(store.waitingSince('ENG-9')).toBe(0)
    expect(store.groups()).toEqual([])
    expect(store.prefs()).toEqual({ notify: true, notifyElsewhere: false })
    expect(store.links()).toEqual({ a: 'ENG-1' })
  })

  it('forgetting a deleted session clears every trace of it', async () => {
    const g = await store.createGroup('Group')
    await store.moveSession('s1', g.id)
    await store.setPinned('s1', true)
    await store.setArchived('s1', true)
    await store.setLink('s1', 'ENG-2')
    await store.forgetSession('s1')
    expect(store.groupOf('s1')).toBeNull()
    expect(store.isPinned('s1')).toBe(false)
    expect(store.isArchived('s1')).toBe(false)
    expect(store.links().s1).toBeUndefined()
  })

  it('deleting a group returns its sessions instead of deleting them', async () => {
    const g = await store.createGroup('Temp')
    await store.moveSession('s2', g.id)
    await store.deleteGroup(g.id)
    expect(store.groupOf('s2')).toBeNull()
    expect(() => store.moveSession('s2', g.id)).toThrow('Group not found')
  })

  it('writes the file atomically and readable as JSON', async () => {
    await store.setPref('notifyElsewhere', true)
    const saved = JSON.parse(readFileSync(join(dir, 'session-desk.json'), 'utf8'))
    expect(saved.prefs.notifyElsewhere).toBe(true)
  })
})
