// Stand-in for the parts of Electron the main-process modules touch.
import { tmpdir } from 'node:os'

export const app = {
  getPath: (_name: string) => process.env.SESSION_DESK_TEST_USERDATA ?? tmpdir(),
  // Running from source: the repo root, where hooks/status-hook.sh lives.
  isPackaged: false,
  getAppPath: () => process.cwd(),
  dock: { setBadge: (_text: string) => {} }
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error('not in tests')
  },
  decryptString: () => {
    throw new Error('not in tests')
  }
}

export class Notification {
  static isSupported = () => false
  on() {}
  show() {}
}
