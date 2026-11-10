import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  copilotTitleLookup,
  defaultSessionStateDir,
  findSessionForPid,
  isDescendant,
  parseFlatYaml,
  readCopilotSessions,
  type CopilotSession,
} from '../../../src/agents/copilot-sessions';
import { processParents } from '../../../src/agents/process-tree';

const WORKSPACE = `id: 2b2dc4a5-1287-4276-a265-6dacc97bab5b
cwd: C:\\Users\\me\\voice-bridge
repository: stefaneicher/voice-bridge
name: Write Message Function
user_named: false
created_at: 2026-11-10T20:35:53.430Z
updated_at: 2026-11-10T20:37:57.960Z
`;

function sampleRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'vb-copilot-'));
  const a = join(root, '2b2dc4a5-1287-4276-a265-6dacc97bab5b');
  mkdirSync(a);
  writeFileSync(join(a, 'workspace.yaml'), WORKSPACE.replace(/\n/g, '\r\n'));
  writeFileSync(join(a, 'inuse.42956.lock'), '42956');
  writeFileSync(join(a, 'inuse.42956.hold'), '');
  const b = join(root, 'no-yaml');
  mkdirSync(b);
  writeFileSync(join(b, 'inuse.7.lock'), '7');
  writeFileSync(join(root, 'stray-file.txt'), 'x');
  return root;
}

describe('parseFlatYaml', () => {
  it('reads flat keys, strips quotes and skips nested or empty values', () => {
    const y = parseFlatYaml(`name: "Quoted: yes"\nempty:\nlist:\n  - a\nother: 'x'\n# c\nplain: v`);
    expect(y).toEqual({ name: 'Quoted: yes', other: 'x', plain: 'v' });
  });
});

describe('readCopilotSessions', () => {
  it('reads name, cwd, update time and lock PIDs from sample files', async () => {
    const sessions = await readCopilotSessions(sampleRoot());
    const byId = new Map(sessions.map((s) => [s.id, s]));
    expect(byId.get('2b2dc4a5-1287-4276-a265-6dacc97bab5b')).toEqual({
      id: '2b2dc4a5-1287-4276-a265-6dacc97bab5b',
      name: 'Write Message Function',
      cwd: 'C:\\Users\\me\\voice-bridge',
      updatedAt: '2026-11-10T20:37:57.960Z',
      lockPids: [42956],
    });
    expect(byId.get('no-yaml')).toEqual({
      id: 'no-yaml',
      name: undefined,
      cwd: undefined,
      updatedAt: undefined,
      lockPids: [7],
    });
    expect(sessions).toHaveLength(2);
  });

  it('returns an empty list when the folder is missing', async () => {
    expect(await readCopilotSessions(join(tmpdir(), 'vb-does-not-exist-' + Date.now()))).toEqual(
      [],
    );
  });

  it('defaults to ~/.copilot/session-state', () => {
    expect(defaultSessionStateDir()).toMatch(/[\\/]\.copilot[\\/]session-state$/);
  });
});

describe('PID matching', () => {
  // copilot.exe 42956 <- node 13988 <- cmd.exe 23392 (PTY) <- vb run 23308
  const tree = new Map([
    [42956, 13988],
    [13988, 23392],
    [23392, 23308],
    [23308, 1],
    [500, 1],
  ]);
  const parentOf = (p: number) => tree.get(p);
  const s = (id: string, lockPids: number[], updatedAt?: string): CopilotSession => ({
    id,
    name: id,
    updatedAt,
    lockPids,
  });

  it('follows the parent chain', () => {
    expect(isDescendant(42956, 23392, parentOf)).toBe(true);
    expect(isDescendant(42956, 42956, parentOf)).toBe(true);
    expect(isDescendant(500, 23392, parentOf)).toBe(false);
    expect(isDescendant(1, 23392, () => 1)).toBe(false);
  });

  it('finds the session running in a PTY and prefers the newest on ties', () => {
    const sessions = [
      s('elsewhere', [500]),
      s('stale', [999]),
      s('old', [42956], '2026-01-01'),
      s('new', [42956], '2026-02-01'),
    ];
    expect(findSessionForPid(23392, sessions, parentOf)?.id).toBe('new');
    expect(findSessionForPid(777, sessions, parentOf)).toBeUndefined();
  });

  it('builds a title lookup from sessions and the process tree', async () => {
    const lookup = copilotTitleLookup(
      async () => [s('Write Message Function', [42956]), { id: 'x', lockPids: [500] }],
      async () => tree,
    );
    const titles = await lookup([23392, 500, 777]);
    expect([...titles]).toEqual([[23392, 'Write Message Function']]);
  });
});

describe('processParents', () => {
  it('knows the current process and its parent', async () => {
    const parents = await processParents();
    expect(parents.get(process.pid)).toBe(process.ppid);
  });
});
