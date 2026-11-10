import { describe, expect, it } from 'vitest';
import { pipePath, sanitizeName } from '../../../src/agents/pipe';

describe('pipe names', () => {
  it('include user and profile on Windows', () => {
    expect(pipePath('Citrix', 'win32', 'Stefan E.')).toBe(
      '\\\\.\\pipe\\voice-bridge-stefan-e-citrix',
    );
  });
  it('use a socket file elsewhere', () => {
    expect(pipePath('privat', 'linux', 'anna')).toMatch(/voice-bridge-anna-privat\.sock$/);
  });
  it('sanitizes names', () => {
    expect(sanitizeName('../../etc')).toBe('etc');
    expect(sanitizeName('')).toBe('default');
    expect(sanitizeName('A'.repeat(80))).toHaveLength(40);
  });
});
