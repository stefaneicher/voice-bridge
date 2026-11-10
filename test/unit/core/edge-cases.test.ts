import { describe, expect, it, vi } from 'vitest';
import { AgentRegistry, SessionController, errorMessage } from '../../../src/core';
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

function setup() {
  const clock = new FakeClock();
  const input = new FakeInput();
  const recorder = new FakeRecorder();
  const stt = new FakeStt();
  const inserter = new FakeInserter();
  const adapter = new FakeAdapter([session(1), session(2)]);
  const controller = new SessionController({
    input,
    recorder,
    stt,
    inserter,
    agents: new AgentRegistry([adapter]),
    clock,
  });
  const hold = async (action: 'dictate' | 'agent') => {
    input.emit({ type: 'down', action });
    await flush();
    clock.advance(500);
    input.emit({ type: 'up', action });
    await flush();
  };
  return { clock, input, recorder, stt, inserter, adapter, controller, hold };
}

describe('SessionController edge cases', () => {
  it('reports a recorder that fails to stop', async () => {
    const t = setup();
    t.recorder.stop = () => Promise.reject(new Error('device lost'));
    await t.hold('dictate');
    expect(t.controller.getState().failures[0]).toMatchObject({
      kind: 'recorder',
      message: expect.stringContaining('device lost'),
    });
  });

  it('turns a throwing inserter into an insert failure with the text kept', async () => {
    const t = setup();
    t.inserter.insert = () => Promise.reject(new Error('blocked'));
    await t.hold('dictate');
    expect(t.controller.getState().failures[0]).toMatchObject({
      kind: 'insert',
      text: 'Hallo Welt',
      message: expect.stringContaining('blocked'),
    });
  });

  it('names an unknown insert error', async () => {
    const t = setup();
    t.inserter.nextResult = { ok: false, reason: 'io' };
    await t.hold('dictate');
    expect(t.controller.getState().failures[0]?.message).toContain('unbekannter Fehler');
  });

  it('describes delivery failures without detail', async () => {
    const t = setup();
    t.adapter.nextResult = { ok: false, reason: 'io' };
    await t.hold('agent');
    expect(t.controller.getState().failures[0]?.message).toContain('E/A-Fehler');
  });

  it('ignores unknown failures and send-to without text', async () => {
    const t = setup();
    await t.controller.resolveFailure('nope', { type: 'discard' });
    t.recorder.failStart = new Error('mic');
    t.input.emit({ type: 'down', action: 'dictate' });
    await flush();
    const [f] = t.controller.getState().failures;
    await t.controller.resolveFailure(f!.id, { type: 'send-to', sessionId: 's1' });
    await t.controller.resolveFailure(f!.id, { type: 'retry' });
    expect(t.controller.getState().failures).toHaveLength(1);
    expect(t.adapter.sent).toEqual([]);
  });

  it('can be paused and resumed', async () => {
    const t = setup();
    t.controller.setPaused(true);
    t.controller.setPaused(false);
    await t.hold('dictate');
    expect(t.inserter.inserted).toEqual(['Hallo Welt']);
  });

  it('ignores wheel and clicks outside an agent recording', async () => {
    const t = setup();
    t.input.emit({ type: 'wheel', delta: 1 });
    t.controller.selectSession('s1');
    expect(t.controller.getState().phase.name).toBe('idle');
  });
});

describe('AgentRegistry details', () => {
  it('reveals a session through its adapter', async () => {
    const reveal = vi.fn(async () => {});
    const a = Object.assign(new FakeAdapter([session(1)]), { reveal });
    const reg = new AgentRegistry([a]);
    await reg.reveal('s1');
    await reg.reveal('missing');
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('treats a session of an unknown adapter as gone', async () => {
    const a = new FakeAdapter([session(1, { adapterId: 'other' })]);
    expect(await new AgentRegistry([a]).send('s1', 'x')).toMatchObject({
      ok: false,
      reason: 'gone',
    });
  });

  it('formats non-Error values', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});
