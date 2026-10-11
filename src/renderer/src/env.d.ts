import type { DeskApi } from '../../shared/types'

declare global {
  /** package.json's version, set at build time. */
  const __APP_VERSION__: string
  interface Window {
    desk: DeskApi
  }
}
