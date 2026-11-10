import { describe, expect, it } from 'vitest';
import { AgentRegistry, SessionController, countWords } from '../../../src/core';
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

function setup(opts: { sessions?: number; lastSessionId?: string | null } = {}) {
  const clock = new FakeClock();
  const input = new FakeInput();
  const recorder = new FakeRecorder();
  const stt = new FakeStt();
  const inserter = new FakeInserter();
  const adapter = new FakeAdapter(
    Array.from({ length: opts.sessions ?? 3 }, (_, i) => session(i + 1)),
  );
  const controller = new SessionController({
    input,
    recorder,
    stt,
    inserter,
    agents: new AgentRegistry([adapter]),
    clock,
    lastSessionId: opts.lastSessionId ?? null,
  });
  const down = async (action: 'dictate' | 'agent') => {
    input.emit({ type: 'down', action });
    await flush();
  };
  const up = async (action: 'dictate' | 'agent', afterMs = 500) => {
    clock.advance(afterMs);
    input.emit({ type: 'up', action });
    await flush();
  };
  return { clock, input, recorder, stt, inserter, adapter, controller, down, up };
}

describe('SessionController', () => {
  it('drops holds shorter than the minimum silently', async () => {
    const t = setup();
    await t.down('dictate');
    await t.up('dictate', 120);
    expect(t.recorder.cancels).toBe(1);
    expect(t.stt.calls).toHaveLength(0);
    expect(t.controller.getState()).toMatchObject({ phase: { name: 'idle' }, failures: [] });
  });

  it('ends a recording via watchdog when the release is missed', async () => {
    const t = setup();
    await t.down('dictate');
    t.clock.advance(120_000);
    await flush();
    expect(t.stt.calls).toHaveLength(1);
    expect(t.inserter.inserted).toEqual(['Hallo Welt']);
  });

  it('ignores input while paused and aborts a running recording when pausing', async () => {
    const t = setup();
    await t.down('dictate');
    t.controller.setPaused(true);
    expect(t.recorder.cancels).toBe(1);
    expect(t.controller.getState().phase.name).toBe('idle');
    await t.down('dictate');
    expect(t.recorder.starts).toBe(1);
  });

  it('ignores a second hold while busy', async () => {
    const t = setup();
    await t.down('dictate');
    await t.down('agent');
    expect(t.controller.getState().phase).toMatchObject({ name: 'recording', mode: 'dictate' });
  });

  it('preselects the last used session', async () => {
    const t = setup({ lastSessionId: 's3' });
    await t.down('agent');
    expect(t.controller.getState().phase).toMatchObject({ selectedId: 's3' });
  });

  it('debounces wheel events closer than 120 ms', async () => {
    const t = setup();
    await t.down('agent');
    t.input.emit({ type: 'wheel', delta: 1 });
    t.clock.advance(50);
    t.input.emit({ type: 'wheel', delta: 1 });
    expect(t.controller.getState().phase).toMatchObject({ selectedId: 's2' });
    t.clock.advance(120);
    t.input.emit({ type: 'wheel', delta: 1 });
    expect(t.controller.getState().phase).toMatchObject({ selectedId: 's3' });
  });

  it('ignores clicks on gone or unknown sessions', async () => {
    const t = setup();
    await t.down('agent');
    t.controller.selectSession('s2');
    t.adapter.remove('s2');
    await flush();
    t.controller.selectSession('nope');
    expect(t.controller.getState().phase).toMatchObject({ selectedId: 's2' });
  });

  it('keeps the text and offers a choice when no session exists', async () => {
    const t = setup({ sessions: 0 });
    await t.down('agent');
    expect(t.controller.getState().phase).toMatchObject({ loading: false, sessions: [] });
    await t.up('agent');
    const [f] = t.controller.getState().failures;
    expect(f).toMatchObject({ kind: 'no-sessions', text: 'Hallo Welt' });

    t.adapter.setSessions([session(7)]);
    await t.controller.resolveFailure(f!.id, { type: 'send-to', sessionId: 's7' });
    expect(t.adapter.sent).toEqual([{ sessionId: 's7', text: 'Hallo Welt' }]);
  });

  it('selects the first session when the list was empty and one appears', async () => {
    const t = setup({ sessions: 0 });
    await t.down('agent');
    t.adapter.setSessions([session(4)]);
    await flush();
    expect(t.controller.getState().phase).toMatchObject({ selectedId: 's4' });
  });

  it('retries a failed delivery to the same session only', async () => {
    const t = setup();
    t.adapter.nextResult = { ok: false, reason: 'busy' };
    await t.down('agent');
    await t.up('agent');
    const [f] = t.controller.getState().failures;
    expect(f).toMatchObject({ kind: 'delivery', target: { id: 's1' } });
    await t.controller.resolveFailure(f!.id, { type: 'retry' });
    expect(t.adapter.sent).toEqual([{ sessionId: 's1', text: 'Hallo Welt' }]);
    expect(t.controller.getState().lastSessionId).toBe('s1');
  });

  it('keeps a failure when send-to targets a vanished session', async () => {
    const t = setup();
    t.adapter.nextResult = { ok: false, reason: 'io' };
    await t.down('agent');
    await t.up('agent');
    const [f] = t.controller.getState().failures;
    await t.controller.resolveFailure(f!.id, { type: 'send-to', sessionId: 'gone' });
    expect(t.controller.getState().failures).toHaveLength(1);
    expect(t.controller.getState().failures[0]).toMatchObject({
      kind: 'session-gone',
      text: 'Hallo Welt',
    });
  });

  it('reports a microphone failure', async () => {
    const t = setup();
    t.recorder.failStart = new Error('NotAllowed');
    await t.down('dictate');
    expect(t.controller.getState().failures[0]).toMatchObject({ kind: 'recorder' });
    expect(t.controller.getState().phase.name).toBe('idle');
  });

  it('reports no-textfield with the text kept', async () => {
    const t = setup();
    t.inserter.nextResult = { ok: false, reason: 'no-textfield' };
    await t.down('dictate');
    await t.up('dictate');
    expect(t.controller.getState().failures[0]).toMatchObject({
      kind: 'no-textfield',
      text: 'Hallo Welt',
    });
  });

  it('does nothing for an empty transcript', async () => {
    const t = setup();
    t.stt.results = [{ text: '   ' }];
    await t.down('dictate');
    await t.up('dictate');
    expect(t.inserter.inserted).toEqual([]);
    expect(t.controller.getState()).toMatchObject({ phase: { name: 'idle' }, failures: [] });
  });

  it('passes the raw transcript through to the done state', async () => {
    const t = setup();
    t.stt.results = [{ text: 'Die Migration ist fertig.', raw: 'D Migration isch fertig.' }];
    await t.down('dictate');
    await t.up('dictate');
    expect(t.controller.getState().phase).toMatchObject({
      name: 'done',
      rawText: 'D Migration isch fertig.',
      words: 4,
    });
  });

  it('discards failures on request', async () => {
    const t = setup();
    t.stt.results = [new Error('x')];
    await t.down('dictate');
    await t.up('dictate');
    const [f] = t.controller.getState().failures;
    await t.controller.resolveFailure(f!.id, { type: 'discard' });
    expect(t.controller.getState().failures).toEqual([]);
  });

  it('notifies subscribers and stops after dispose', async () => {
    const t = setup();
    const phases: string[] = [];
    t.controller.subscribe((s) => phases.push(s.phase.name));
    await t.down('dictate');
    await t.up('dictate');
    expect(phases).toContain('recording');
    expect(phases.at(-1)).toBe('done');
    t.controller.dispose();
    await t.down('dictate');
    expect(t.recorder.starts).toBe(1);
  });

  it('applies new timing via configure()', async () => {
    const t = setup();
    t.controller.configure({ minHoldMs: 1000 });
    await t.down('dictate');
    await t.up('dictate', 800);
    expect(t.stt.calls).toHaveLength(0);
  });

  it('counts words', () => {
    expect(countWords('  eins zwei\ndrei ')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});
