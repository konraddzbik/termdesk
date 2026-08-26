import { safeStorage } from 'electron'

/**
 * Thin wrapper around Electron's safeStorage (OS keychain-backed encryption).
 *
 * Secrets arriving from the renderer are encrypted immediately and stored
 * only as ciphertext. They are decrypted exclusively at connection time in
 * the main process — never logged, never returned to the renderer.
 */

/**
 * Refuses to proceed unless a real OS-backed encryption backend is active.
 *
 * On Linux, `isEncryptionAvailable()` returns true even when Electron silently
 * falls back to the `basic_text` backend, which encrypts with the well-known
 * hardcoded Chromium OSCrypt key (derived from the literal "peanuts"). That is
 * effectively plaintext: anyone who copies the DB/license files can decrypt
 * every secret offline. We require an actual keyring (gnome-libsecret/kwallet)
 * and fail closed otherwise. macOS/Windows have no such insecure fallback.
 */
function assertSecureBackend(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secret encryption is not available on this system')
  }
  // getSelectedStorageBackend is Linux-only in Electron and always present on a
  // real Linux runtime; the typeof guard keeps an incomplete mock (or an
  // unexpected runtime) from crashing encryption rather than weakening it.
  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
    const backend = safeStorage.getSelectedStorageBackend()
    if (backend === 'basic_text' || backend === 'unknown') {
      throw new Error(
        'A secure OS keyring (gnome-libsecret or kwallet) is required to store credentials. ' +
          'The current session has no unlocked keyring, so secrets cannot be encrypted securely. ' +
          'Unlock or configure your keyring and restart TermDesk.',
      )
    }
  }
}

export function encryptSecret(plain: string): Buffer {
  assertSecureBackend()
  return safeStorage.encryptString(plain)
}

export function decryptSecret(blob: Buffer): string {
  assertSecureBackend()
  return safeStorage.decryptString(blob)
}
