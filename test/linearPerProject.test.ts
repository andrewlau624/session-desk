import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tmp } from './helpers'

// A reversible stand-in for Keychain encryption.
vi.mock('electron', async () => ({
  ...(await vi.importActual<object>('./fakes/electron')),
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

const dir = tmp()
process.env.SESSION_DESK_TEST_USERDATA = dir
// From before Linear was per project: one app-wide key and workspace.
const legacyKey = Buffer.from('enc:lin_api_first').toString('base64')
writeFileSync(
  join(dir, 'session-desk.json'),
  JSON.stringify({ linearKey: legacyKey, linearWorkspace: { urlKey: 'acme', teamKeys: ['ENG', 'OPS', 'WEB'] } })
)
// The shared test setup already loaded the store; load it again with the Keychain stand-in.
vi.resetModules()
const { store } = await import('../src/main/store')

const FIRST = '/Users/me/Development/acme-app'
const OTHER = '/Users/me/Development/other'

describe('Linear per project folder', () => {
  it('hands the old app-wide connection to the current project, once', async () => {
    await store.adoptLegacyLinear(FIRST)
    expect(store.linearKey(FIRST)).toBe('lin_api_first')
    expect(store.linearWorkspace(FIRST)).toEqual({ urlKey: 'acme', teamKeys: ['ENG', 'OPS', 'WEB'] })
    const saved = JSON.parse(readFileSync(join(dir, 'session-desk.json'), 'utf8'))
    expect(saved.linearKey).toBeUndefined()
    expect(saved.linearWorkspace).toBeUndefined()
    // Nothing left to adopt: another project doesn't inherit it.
    await store.adoptLegacyLinear(OTHER)
    expect(store.linearKey(OTHER)).toBeNull()
  })

  it('each project keeps its own key and workspace; the key is stored encrypted', async () => {
    await store.setLinearKey(OTHER, 'lin_api_other')
    await store.setLinearWorkspace(OTHER, { urlKey: 'assisted', teamKeys: ['MAR'] })
    expect(store.linearKey(OTHER)).toBe('lin_api_other')
    expect(store.linearKey(FIRST)).toBe('lin_api_first')
    expect(store.linearWorkspace(OTHER)?.teamKeys).toEqual(['MAR'])
    const saved = readFileSync(join(dir, 'session-desk.json'), 'utf8')
    expect(saved).not.toContain('lin_api_other')

    // Disconnecting one leaves the other.
    await store.setLinearKey(OTHER, null)
    expect(store.linearKey(OTHER)).toBeNull()
    expect(store.linearKey(FIRST)).toBe('lin_api_first')
  })
})
