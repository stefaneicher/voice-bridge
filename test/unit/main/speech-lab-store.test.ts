import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWav } from '../../../src/audio/wav';
import type { AudioClip } from '../../../src/core';
import { SpeechLabStore, labPackage } from '../../../src/main/speech-lab-store';
import { defaultConfig } from '../../../src/shared/config';
import { labSettings, parseLabPackage, type LabAttempt } from '../../../src/shared/speech-lab';

const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: vi.fn(),
  failRename: false,
}));
vi.mock('node:fs', () => ({
  existsSync: (path: string) => [...io.files.keys()].some((p) => p.startsWith(path)),
  readdirSync: (path: string) =>
    [...io.files.keys()].filter((p) => p.startsWith(path)).map((p) => p.slice(path.length + 1)),
  readFileSync: (path: string) => {
    if (!io.files.has(path)) throw new Error('missing');
    return io.files.get(path);
  },
  statSync: (path: string) => ({ size: io.files.get(path)?.length ?? 0 }),
  mkdirSync: vi.fn(),
  writeFileSync: (path: string, value: string) => {
    io.writes(path, value);
    io.files.set(path, value);
  },
  renameSync: (from: string, to: string) => {
    if (io.failRename) throw new Error('rename failed');
    io.files.set(to, io.files.get(from)!);
    io.files.delete(from);
  },
  unlinkSync: (path: string) => io.files.delete(path),
}));

const directory = join('test', 'lab-fixture');
const id = '12345678-1234-1234-1234-123456789abc';
function attempt(): LabAttempt {
  return {
    schemaVersion: 1,
    id,
    createdAt: '2026-11-13T12:00:00.000Z',
    expected: 'Prüfe den Pull Request.',
    finalText: 'Prüfe den Pull Request.',
    settings: labSettings(defaultConfig('privat')),
    events: [{ name: 'release', atMs: 300 }],
    previews: [{ text: 'Prüfe', atMs: 100 }],
    review: 'correct',
    correction: '',
    releasedAtMs: 300,
    finalAtMs: 500,
    durationMs: 300,
  };
}
const clip: AudioClip = {
  data: encodeWav(new Float32Array([0.2, -0.2]), 16000),
  mimeType: 'audio/wav',
  durationMs: 300,
};

beforeEach(() => {
  io.files.clear();
  io.writes.mockClear();
  io.failRename = false;
});

describe('speech lab local consent and portable packages', () => {
  it('creates no directory/file by default, and refuses false or truthy non-boolean consent', () => {
    const store = new SpeechLabStore(directory);
    expect(store.list()).toEqual({ entries: [] });
    expect(() => store.save(attempt(), clip, false)).toThrow('Zustimmung');
    expect(() => store.save(attempt(), clip, 'true' as unknown as boolean)).toThrow('Zustimmung');
    expect(io.writes).not.toHaveBeenCalled();
    expect(io.files.size).toBe(0);
  });

  it('persists and reloads a versioned package with exact WAV and allows deletion', () => {
    const store = new SpeechLabStore(directory);
    const a = attempt();
    store.save(a, clip, true);
    expect(store.list().entries).toEqual([a]);
    const p = store.read(id)!;
    expect(p).toEqual(labPackage(a, clip));
    expect(new Uint8Array(Buffer.from(p.audio.data, 'base64'))).toEqual(clip.data);
    store.delete(id);
    expect(store.read(id)).toBeNull();
    expect(store.list().entries).toEqual([]);
    expect(() => store.delete('..\\secrets')).toThrow('ID');
    expect(store.read('..\\secrets')).toBeNull();
  });

  it('never includes API keys, endpoint credentials, session routing or unknown fields', () => {
    const a = attempt();
    const config = defaultConfig('privat');
    config.stt.baseUrl = 'https://user:password@example.invalid/v1?key=secret';
    const snapshot = labSettings(config);
    const p = labPackage({ ...a, settings: snapshot }, clip);
    const untrusted = {
      ...p,
      apiKey: 'secret',
      attempt: {
        ...p.attempt,
        targetSessionId: 'private-session',
        settings: { ...p.attempt.settings, apiKey: 'secret', baseUrl: config.stt.baseUrl },
      },
    };
    const output = JSON.stringify(parseLabPackage(untrusted));
    for (const secret of ['secret', 'password', 'example.invalid', 'private-session', 'apiKey']) {
      expect(output).not.toContain(secret);
    }
  });

  it('cleans up a failed atomic-write fragment and preserves the previous saved package', () => {
    const store = new SpeechLabStore(directory);
    store.save(attempt(), clip, true);
    io.failRename = true;
    expect(() => store.save({ ...attempt(), correction: 'Geändert' }, clip, true)).toThrow(
      'rename failed',
    );
    expect(store.read(id)?.attempt.correction).toBe('');
    expect([...io.files.keys()]).toEqual([join(directory, `${id}.json`)]);
  });

  it('rejects malformed, oversized, unsupported or wrongly typed data without throwing', () => {
    const p = labPackage(attempt(), clip);
    expect(parseLabPackage(null)).toBeNull();
    expect(parseLabPackage({ ...p, schemaVersion: 2 })).toBeNull();
    expect(parseLabPackage({ ...p, attempt: { ...p.attempt, id: '..\\secrets' } })).toBeNull();
    expect(parseLabPackage({ ...p, attempt: { ...p.attempt, finalAtMs: NaN } })).toBeNull();
    expect(parseLabPackage({ ...p, attempt: { ...p.attempt, previews: 'bad' } })).toBeNull();
    expect(parseLabPackage({ ...p, attempt: { ...p.attempt, review: ['correct'] } })).toBeNull();
    expect(parseLabPackage({ ...p, audio: { ...p.audio, data: 'not base64' } })).toBeNull();
    expect(
      parseLabPackage({ ...p, attempt: { ...p.attempt, expected: 'x'.repeat(2001) } }),
    ).toBeNull();
  });

  it('skips corrupt files with a visible warning instead of losing valid entries', () => {
    const store = new SpeechLabStore(directory);
    store.save(attempt(), clip, true);
    io.files.set(join(directory, '22345678-1234-1234-1234-123456789abc.json'), '{broken');
    expect(store.list()).toEqual({
      entries: [attempt()],
      warning: expect.stringContaining('1 ungültige'),
    });
  });

  it.each(['minimal', 'low', 'medium', 'high', 'xhigh'] as const)(
    'round-trips the supported live delay %s',
    (delay) => {
      const a = attempt();
      a.settings.live.delay = delay;
      expect(parseLabPackage(labPackage(a, clip))?.attempt.settings.live.delay).toBe(delay);
    },
  );
});
