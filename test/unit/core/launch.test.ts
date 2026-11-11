import { describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  NEW_SESSION_ID,
  SessionController,
  folderName,
  withNewSessionRow,
  type SessionLauncher,
  type SessionView,
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

class FakeLauncher implements SessionLauncher {
  launches: { folder: string; token: string }[] = [];
  isAvailable = true;
  failNext: Error | null = null;

  available(): boolean {
    return this.isAvailable;
  }

  async launch(folder: string, token: string): Promise<void> {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
    this.launches.push({ folder, token });
  }
}

function setup(opts: { launcher?: FakeLauncher | null; cwds?: (string | undefined)[] } = {}) {
  const clock = new FakeClock();
  const input = new FakeInput();
  const recorder = new FakeRecorder();
  const stt = new FakeStt();
  const inserter = new FakeInserter();
  const cwds = opts.cwds ?? ['C:\\work\\alpha', 'C:\\work\\beta'];
  const adapter = new FakeAdapter(cwds.map((cwd, i) => session(i + 1, cwd ? { cwd } : {})));
  const launcher = opts.launcher === undefined ? new FakeLauncher() : opts.launcher;
  let tokens = 0;
  const controller = new SessionController({
    input,
    recorder,
    stt,
    inserter,
    agents: new AgentRegistry([adapter]),
    clock,
    ...(launcher ? { launcher } : {}),
    createToken: () => `tok${++tokens}`,
  });
  const down = async () => {
    input.emit({ type: 'down', action: 'agent' });
    await flush();
  };
  const up = async () => {
    clock.advance(500);
    input.emit({ type: 'up', action: 'agent' });
    await flush();
  };
  const phase = () => controller.getState().phase;
  const rows = () => {
    const p = phase();
    return p.name === 'recording' && p.mode === 'agent' ? p.sessions : [];
  };
  /** The terminal opened by the launcher registers with the token. */
  const register = (token: string, state: 'idle' | 'busy') => {
    const others = adapter.sessions.filter((s) => s.launchToken !== token);
    adapter.setSessions([
      ...others,
      session(9, { name: 'copilot', cwd: 'C:\\work\\alpha', launchToken: token, state }),
    ]);
  };
  return {
    clock,
    input,
    stt,
    adapter,
    launcher,
    controller,
    down,
    up,
    phase,
    rows,
    register,
  };
}

/** Holds the hotkey, scrolls to the new-session row and releases. */
async function releaseOnNewRow(t: ReturnType<typeof setup>) {
  await t.down();
  t.controller.selectSession(NEW_SESSION_ID);
  await t.up();
}

describe('withNewSessionRow', () => {
  const view = (id: string, cwd?: string): SessionView => ({
    id,
    adapterId: 'fake',
    name: id,
    state: 'idle',
    gone: false,
    ...(cwd ? { cwd } : {}),
  });

  it('follows the selected session, then the previous row, then the last and first one', () => {
    const views = [view('a', 'C:\\a'), view('b'), view('c', 'C:\\c')];
    expect(withNewSessionRow(views, 'c', undefined, true).at(-1)).toMatchObject({
      id: NEW_SESSION_ID,
      cwd: 'C:\\c',
      newSession: true,
    });
    expect(withNewSessionRow(views, 'b', 'C:\\prev', true).at(-1)?.cwd).toBe('C:\\prev');
    expect(withNewSessionRow(views, 'b', undefined, true, 'c').at(-1)?.cwd).toBe('C:\\c');
    expect(withNewSessionRow(views, null, undefined, true).at(-1)?.cwd).toBe('C:\\a');
  });

  it('replaces an old row instead of adding a second one', () => {
    const once = withNewSessionRow([view('a', 'C:\\a')], 'a', undefined, true);
    const twice = withNewSessionRow(once, 'a', undefined, true);
    expect(twice.filter((v) => v.newSession)).toHaveLength(1);
  });

  it('is hidden without a known folder or without a launcher', () => {
    expect(withNewSessionRow([view('a')], 'a', undefined, true)).toHaveLength(1);
    expect(withNewSessionRow([view('a', 'C:\\a')], 'a', undefined, false)).toHaveLength(1);
  });

  it('shows the last path segment as folder', () => {
    expect(folderName('C:\\work\\voice-bridge\\')).toBe('voice-bridge');
    expect(folderName('/home/me/repo')).toBe('repo');
    expect(folderName('')).toBe('');
  });
});

describe('Neue Session per Stimme (T-026)', () => {
  it('adds the row at the end of the list with the folder of the selected session', async () => {
    const t = setup();
    await t.down();
    expect(t.rows().map((r) => r.id)).toEqual(['s1', 's2', NEW_SESSION_ID]);
    expect(t.rows().at(-1)).toMatchObject({ cwd: 'C:\\work\\alpha', newSession: true });
    expect(t.phase()).toMatchObject({ selectedId: 's1' });

    t.input.emit({ type: 'wheel', delta: 1 });
    expect(t.rows().at(-1)?.cwd).toBe('C:\\work\\beta');
    t.clock.advance(200);
    t.input.emit({ type: 'wheel', delta: 1 });
    // Selecting the row itself keeps the folder of the session selected before.
    expect(t.phase()).toMatchObject({ selectedId: NEW_SESSION_ID });
    expect(t.rows().at(-1)?.cwd).toBe('C:\\work\\beta');
  });

  it('keeps the row when the session list changes while it is selected', async () => {
    const t = setup();
    await t.down();
    t.controller.selectSession(NEW_SESSION_ID);
    t.adapter.remove('s2');
    await flush();
    expect(t.rows().map((r) => r.id)).toEqual(['s1', NEW_SESSION_ID]);
    expect(t.rows().some((r) => r.gone)).toBe(false);
    expect(t.phase()).toMatchObject({ selectedId: NEW_SESSION_ID });
  });

  it('hides the row when no launcher is available or no folder is known', async () => {
    const unavailable = new FakeLauncher();
    unavailable.isAvailable = false;
    for (const t of [
      setup({ launcher: null }),
      setup({ launcher: unavailable }),
      setup({ cwds: [undefined, undefined] }),
    ]) {
      await t.down();
      expect(t.rows().some((r) => r.newSession)).toBe(false);
    }
  });

  it('hides the row when the launcher probe throws', async () => {
    const launcher = new FakeLauncher();
    launcher.available = () => {
      throw new Error('probe failed');
    };
    const t = setup({ launcher });
    await t.down();
    expect(t.rows().some((r) => r.newSession)).toBe(false);
  });

  it('starts one terminal and sends only once exactly that session is ready', async () => {
    const t = setup();
    await releaseOnNewRow(t);
    expect(t.launcher!.launches).toEqual([{ folder: 'C:\\work\\alpha', token: 'tok1' }]);
    expect(t.phase()).toMatchObject({
      name: 'launching',
      folder: 'C:\\work\\alpha',
      token: 'tok1',
    });

    // Another new session (other token) is never used.
    t.adapter.setSessions([...t.adapter.sessions, session(8, { launchToken: 'other' })]);
    await flush();
    // Registered but still busy (e.g. asking whether to trust the folder): nothing is sent.
    t.register('tok1', 'busy');
    await flush();
    expect(t.adapter.sent).toEqual([]);
    expect(t.phase().name).toBe('launching');

    t.register('tok1', 'idle');
    await flush();
    expect(t.adapter.sent).toEqual([{ sessionId: 's9', text: 'Hallo Welt' }]);
    expect(t.phase()).toMatchObject({ name: 'done', target: { id: 's9' } });
    expect(t.controller.getState().lastSessionId).toBe('s9');
  });

  it('sends right away when the session is already ready on the first lookup', async () => {
    const t = setup();
    t.launcher!.launch = async (folder, token) => {
      t.launcher!.launches.push({ folder, token });
      t.adapter.sessions = [...t.adapter.sessions, session(9, { launchToken: token })];
    };
    await releaseOnNewRow(t);
    expect(t.adapter.sent).toEqual([{ sessionId: 's9', text: 'Hallo Welt' }]);
  });

  it('keeps the text after the timeout and only waits again on retry', async () => {
    const t = setup();
    await releaseOnNewRow(t);
    t.register('tok1', 'busy');
    await flush();
    t.clock.advance(20_000);
    await flush();
    expect(t.phase().name).toBe('idle');
    expect(t.adapter.sent).toEqual([]);
    const [f] = t.controller.getState().failures;
    expect(f).toMatchObject({
      kind: 'launch',
      text: 'Hallo Welt',
      launch: { folder: 'C:\\work\\alpha', token: 'tok1' },
    });
    expect(f!.message).toContain('Im Terminal bestätigen');

    const retry = t.controller.resolveFailure(f!.id, { type: 'retry' });
    await flush();
    expect(t.phase()).toMatchObject({ name: 'launching', token: 'tok1' });
    t.register('tok1', 'idle');
    await retry;
    expect(t.launcher!.launches).toHaveLength(1);
    expect(t.adapter.sent).toEqual([{ sessionId: 's9', text: 'Hallo Welt' }]);
    expect(t.controller.getState().failures).toEqual([]);
  });

  it('explains when the new terminal never registered', async () => {
    const t = setup();
    await releaseOnNewRow(t);
    t.clock.advance(20_000);
    await flush();
    const [f] = t.controller.getState().failures;
    expect(f).toMatchObject({ kind: 'launch', text: 'Hallo Welt' });
    expect(f!.message).toContain('nicht gemeldet');
    expect(f!.message).toContain('Im Terminal bestätigen');
  });

  it('keeps the text when the terminal cannot be started and relaunches on retry', async () => {
    const t = setup();
    t.launcher!.failNext = new Error('wt fehlt');
    await releaseOnNewRow(t);
    const [f] = t.controller.getState().failures;
    expect(f).toMatchObject({
      kind: 'launch',
      text: 'Hallo Welt',
      launch: { folder: 'C:\\work\\alpha' },
    });
    expect(f!.launch?.token).toBeUndefined();
    expect(f!.message).toContain('wt fehlt');

    void t.controller.resolveFailure(f!.id, { type: 'retry' });
    await flush();
    expect(t.launcher!.launches).toEqual([{ folder: 'C:\\work\\alpha', token: 'tok2' }]);
  });

  it('starts at most once per token: a second release or retry while pending is ignored', async () => {
    const t = setup();
    t.launcher!.failNext = new Error('x');
    await releaseOnNewRow(t);
    const [f] = t.controller.getState().failures;
    void t.controller.resolveFailure(f!.id, { type: 'retry' });
    await flush();
    expect(t.phase().name).toBe('launching');

    // A new hold while launching is ignored.
    t.input.emit({ type: 'down', action: 'agent' });
    await t.up();
    expect(t.phase().name).toBe('launching');
    expect(t.launcher!.launches).toHaveLength(1);
  });

  it('ignores a retry of a launch failure while another run is busy', async () => {
    const t = setup();
    await releaseOnNewRow(t);
    t.clock.advance(20_000);
    await flush();
    const [f] = t.controller.getState().failures;
    await t.down();
    await t.controller.resolveFailure(f!.id, { type: 'retry' });
    expect(t.controller.getState().failures).toHaveLength(1);
    expect(t.phase()).toMatchObject({ name: 'recording' });
  });

  it('keeps the chosen launch when transcription fails and retries it', async () => {
    const t = setup();
    t.stt.results = [new Error('offline')];
    await releaseOnNewRow(t);
    const [f] = t.controller.getState().failures;
    expect(f).toMatchObject({ kind: 'stt', launch: { folder: 'C:\\work\\alpha' } });
    void t.controller.resolveFailure(f!.id, { type: 'retry' });
    await flush();
    expect(t.launcher!.launches).toHaveLength(1);
    expect(t.phase().name).toBe('launching');
  });

  it('does not start a terminal for an empty transcript', async () => {
    const t = setup();
    t.stt.results = [{ text: '  ' }];
    await releaseOnNewRow(t);
    expect(t.launcher!.launches).toEqual([]);
    expect(t.phase().name).toBe('idle');
  });

  it('stops waiting on dispose', async () => {
    const t = setup();
    await releaseOnNewRow(t);
    t.controller.dispose();
    t.register('tok1', 'idle');
    t.clock.advance(20_000);
    await flush();
    expect(t.adapter.sent).toEqual([]);
    expect(t.controller.getState().failures).toEqual([]);
  });

  it('uses 8 hex characters as default token', async () => {
    const launcher = new FakeLauncher();
    const adapter = new FakeAdapter([session(1, { cwd: 'C:\\a' })]);
    const input = new FakeInput();
    const clock = new FakeClock();
    const controller = new SessionController({
      input,
      recorder: new FakeRecorder(),
      stt: new FakeStt(),
      inserter: new FakeInserter(),
      agents: new AgentRegistry([adapter]),
      clock,
      launcher,
    });
    input.emit({ type: 'down', action: 'agent' });
    await flush();
    controller.selectSession(NEW_SESSION_ID);
    clock.advance(500);
    input.emit({ type: 'up', action: 'agent' });
    await flush();
    expect(launcher.launches[0]?.token).toMatch(/^[0-9a-f]{8}$/);
  });
});
