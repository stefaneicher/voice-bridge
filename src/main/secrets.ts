import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeStorage } from 'electron';

/**
 * API key storage via Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on
 * Linux). Only the encrypted blob touches the disk; without OS encryption nothing is stored.
 */
export class SecretStore {
  constructor(private readonly path: string) {}

  available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  has(): boolean {
    return existsSync(this.path);
  }

  get(): string | null {
    if (!this.has() || !this.available()) return null;
    try {
      return safeStorage.decryptString(readFileSync(this.path));
    } catch {
      return null;
    }
  }

  set(value: string | null): void {
    if (!value) {
      rmSync(this.path, { force: true });
      return;
    }
    if (!this.available()) {
      throw new Error('Sichere Ablage ist auf diesem System nicht verfügbar');
    }
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, safeStorage.encryptString(value), { mode: 0o600 });
  }
}
