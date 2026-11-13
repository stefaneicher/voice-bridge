import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PROFILE = 'privat';

/** Profile names become part of paths and pipe names, so only a safe subset is allowed. */
export function sanitizeName(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean.slice(0, 40) || 'default';
}

/**
 * Pipe/socket path per user and profile (ADR-006, ADR-008). The user name is part of the name
 * because Windows named pipes are machine-wide, which matters on shared servers.
 */
export function pipePath(
  profile: string,
  platform: NodeJS.Platform = process.platform,
  user: string = safeUserName(),
): string {
  const name = `voice-bridge-${sanitizeName(user)}-${sanitizeName(profile)}`;
  if (platform === 'win32') return `\\\\.\\pipe\\${name}`;
  const dir = process.env.XDG_RUNTIME_DIR || tmpdir();
  return join(dir, `${name}.sock`);
}

function safeUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USERNAME ?? process.env.USER ?? 'user';
  }
}
