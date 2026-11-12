import { describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  DESK_STATUS_LABEL,
  NEW_SESSION_ID,
  SessionController,
  deskSessions,
  newSessionFolder,
  type SessionLauncher,
} from '../../../src/core';
import {
  FakeAdapter,
  FakeClock,
  FakeInput,
  FakeInserter,
  FakeRecorder,
  FakeStt,
  flush,
  session,
} from '../../fakes';

describe('deskSessions', () => {
  it('maps states and marks the pinned session', () => {
    const rows = deskSessions(
      [
        session(1, { cwd: 'C:\\work\\alpha' }),
        session(2, { state: 'busy' }),
        session(3, { state: 'unknown' }),
      ],
      's2',
    );
    expect(rows.map((r) => [r.id, r.status, r.pinned, r.folder])).toEqual([
      ['s1', 'ready', false, 'alpha'],
      ['s2', 'busy', true, undefined],
      ['s3', 'unknown', false, undefined],
    ]);
    expect(rows.map((r) => DESK_STATUS_LABEL[r.status])).toEqual([
      'bereit',
      'beschäftigt',
      'unbekannt',
    ]);
  });

  it('keeps a vanished pinned session as «getrennt» with its last known data', () => {
    const known = session(9, { cwd: '/work/gamma', title: 'Fix' });
    const rows = deskSessions([session(1)], 's9', known);
    expect(rows[1]).toMatchObject({
      id: 's9',
      name: 'session-9',
      title: 'Fix',
      folder: 'gamma',
      status: 'gone',
      pinned: true,
    });
  });

  it('shows an unknown pinned ID as «getrennt» without inventing data', () => {
    const rows = deskSessions([], 'pty:old', session(1));
    expect(rows).toEqual([
      expect.objectContaining({ id: 'pty:old', name: 'Unbekannte Session', status: 'gone' }),
    ]);
  });

  it('adds no extra row without a pin', () => {
    expect(deskSessions([session(1)], null)).toHaveLength(1);
  });
});

describe('newSessionFolder', () => {
  const list = [session(1), session(2, { cwd: 'C:\\b' }), session(3, { cwd: 'C:\\c' })];
  it('prefers the pinned session folder', () => {
    expect(newSessionFolder(list, 's3')).toBe('C:\\c');
  });
  it('falls back to the first known folder', () => {
    expect(newSessionFolder(list, 's1')).toBe('C:\\b');
    expect(newSessionFolder(list, null)).toBe('C:\\b');
  });
  it('is undefined without any folder', () => {
    expect(newSessionFolder([session(1)], null)).toBeUndefined();
  });
});

class FakeLauncher implements SessionLauncher {
  launches: { folder: string; token: string }[] = [];
  isAvailable = true;
  fail: Error | null = null;
  available(): boolean {
    if (!this.isAvailable) throw new Error('no terminal');
    return true;
  }
  async launch(folder: string, token: string): Promise<void> {
    if (this.fail) throw this.fail;
    this.launches.push({ folder, token });
  }
}

function setup(launcher: FakeLauncher | null = new FakeLauncher()) {
  const clock = new FakeClock();
  const adapter = new FakeAdapter([session(1), session(2)]);
  const controller = new SessionController({
    input: new FakeInput(),
    recorder: new FakeRecorder(),
    stt: new FakeStt(),
    inserter: new FakeInserter(),
    agents: new AgentRegistry([adapter]),
    clock,
    ...(launcher ? { launcher } : {}),
    createToken: () => 'tok',
  });
  return { clock, adapter, controller, launcher };
}

describe('SessionController desk actions', () => {
  it('pins a session by ID and notifies', () => {
    const { controller } = setup();
    const seen: (string | null)[] = [];
    controller.subscribe((s) => seen.push(s.lastSessionId));
    controller.pinSession('s2');
    controller.pinSession('s2');
    controller.pinSession(NEW_SESSION_ID);
    expect(controller.getState().lastSessionId).toBe('s2');
    expect(seen).toEqual(['s2']);
  });

  it('reports whether a terminal can be launched', () => {
    const launcher = new FakeLauncher();
    expect(setup(launcher).controller.canLaunch()).toBe(true);
    launcher.isAvailable = false;
    expect(setup(launcher).controller.canLaunch()).toBe(false);
    expect(setup(null).controller.canLaunch()).toBe(false);
  });

  it('launches through the launcher and pins the session with the token', async () => {
    const { controller, adapter, launcher } = setup();
    const result = controller.launchSession('C:\\work\\alpha');
    await flush();
    expect(launcher!.launches).toEqual([{ folder: 'C:\\work\\alpha', token: 'tok' }]);
    adapter.setSessions([...adapter.sessions, session(7, { launchToken: 'tok', state: 'busy' })]);
    await expect(result).resolves.toEqual({ ok: true, sessionId: 's7' });
    expect(controller.getState().lastSessionId).toBe('s7');
  });

  it('does not override a pin the user made while the session started', async () => {
    const { controller, adapter } = setup();
    const result = controller.launchSession('C:\\work');
    await flush();
    controller.pinSession('s1');
    adapter.setSessions([session(7, { launchToken: 'tok' })]);
    await expect(result).resolves.toEqual({ ok: true, sessionId: 's7' });
    expect(controller.getState().lastSessionId).toBe('s1');
  });

  it('reports a failed launch', async () => {
    const launcher = new FakeLauncher();
    launcher.fail = new Error('wt.exe fehlt');
    const result = await setup(launcher).controller.launchSession('C:\\work\\alpha');
    expect(result).toEqual({
      ok: false,
      message: 'Neue Session in alpha konnte nicht gestartet werden: wt.exe fehlt.',
    });
    const none = await setup(null).controller.launchSession('C:\\x');
    expect(none.ok).toBe(false);
  });

  it('gives up when the new session never registers, without pinning another', async () => {
    const { controller, clock } = setup();
    const result = controller.launchSession('C:\\work\\alpha');
    await flush();
    clock.advance(20_000);
    await expect(result).resolves.toMatchObject({ ok: false });
    expect(controller.getState().lastSessionId).toBeNull();
  });

  it('stops waiting on dispose', async () => {
    const { controller } = setup();
    const result = controller.launchSession('C:\\work');
    await flush();
    controller.dispose();
    await expect(result).resolves.toMatchObject({ ok: false });
  });
});
