/**
 * The six mandatory scenarios from PLAN §7. These must always be green.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentRegistry, SessionController } from '../../../src/core';
import { ClipboardPasteInserter } from '../../../src/output/inserter';
import {
  FakeAdapter,
  FakeClipboard,
  FakeClock,
  FakeInput,
  FakeInserter,
  FakeKeys,
  FakeRecorder,
  FakeStt,
  flush,
  session,
} from '../../fakes';

function setup(sessionCount = 5) {
  const clock = new FakeClock();
  const input = new FakeInput();
  const recorder = new FakeRecorder();
  const stt = new FakeStt();
  const inserter = new FakeInserter();
  const adapter = new FakeAdapter(Array.from({ length: sessionCount }, (_, i) => session(i + 1)));
  const controller = new SessionController({
    input,
    recorder,
    stt,
    inserter,
    agents: new AgentRegistry([adapter]),
    clock,
  });
  return { clock, input, recorder, stt, inserter, adapter, controller };
}

type Env = ReturnType<typeof setup>;

async function holdAgent(env: Env) {
  env.input.emit({ type: 'down', action: 'agent' });
  await flush();
}

async function wheel(env: Env, delta: 1 | -1, times: number) {
  for (let i = 0; i < times; i++) {
    env.clock.advance(150);
    env.input.emit({ type: 'wheel', delta });
  }
  await flush();
}

async function release(env: Env, action: 'agent' | 'dictate') {
  env.clock.advance(500);
  env.input.emit({ type: 'up', action });
  await flush();
}

function phase(env: Env) {
  return env.controller.getState().phase;
}

describe('PLAN §7 required scenarios', () => {
  let env: Env;
  beforeEach(() => {
    env = setup();
  });

  it('1 · hold/release: recording starts on down and ends only on up of the same key', async () => {
    env.input.emit({ type: 'down', action: 'dictate' });
    await flush();
    expect(env.recorder.recording).toBe(true);
    expect(phase(env)).toMatchObject({ name: 'recording', mode: 'dictate' });

    // Another key's release, wheel and time passing do not end the recording.
    env.input.emit({ type: 'up', action: 'agent' });
    env.input.emit({ type: 'wheel', delta: 1 });
    env.clock.advance(5_000);
    await flush();
    expect(env.recorder.recording).toBe(true);
    expect(phase(env).name).toBe('recording');

    await release(env, 'dictate');
    expect(env.recorder.recording).toBe(false);
    expect(env.stt.calls).toHaveLength(1);
    expect(env.inserter.inserted).toEqual(['Hallo Welt']);
    expect(phase(env)).toMatchObject({ name: 'done', mode: 'dictate', words: 2 });
  });

  it('2 · wheel selection on release: 3× down then release targets session 4 by ID', async () => {
    await holdAgent(env);
    expect(env.input.wheelCapture).toBe(true);
    expect(phase(env)).toMatchObject({ selectedId: 's1' });

    await wheel(env, 1, 3);
    expect(phase(env)).toMatchObject({ selectedId: 's4' });

    // Reordering the list during recording does not change the target: it is bound to the ID.
    env.adapter.setSessions([...env.adapter.sessions].reverse());
    await flush();

    await release(env, 'agent');
    expect(env.input.wheelCapture).toBe(false);
    expect(env.adapter.sent).toEqual([{ sessionId: 's4', text: 'Hallo Welt' }]);
    expect(phase(env)).toMatchObject({ name: 'done', target: { id: 's4' } });
  });

  it('3 · click during recording changes the target while recording continues', async () => {
    await holdAgent(env);
    env.recorder.feed(100);
    env.controller.selectSession('s2');
    await flush();

    expect(phase(env)).toMatchObject({ name: 'recording', mode: 'agent', selectedId: 's2' });
    expect(env.recorder.recording).toBe(true);
    env.recorder.feed(100);
    expect(env.recorder.buffer.length).toBe(200);

    await release(env, 'agent');
    expect(env.stt.calls[0]!.data.length).toBe(200);
    expect(env.adapter.sent).toEqual([{ sessionId: 's2', text: 'Hallo Welt' }]);
  });

  it('4 · vanished session: Failed(gone), nobody else receives the text, text is kept', async () => {
    await holdAgent(env);
    await wheel(env, 1, 2); // s3
    env.adapter.remove('s3');
    await flush();

    const rec = phase(env);
    expect(rec).toMatchObject({ name: 'recording', selectedId: 's3' });
    if (rec.name === 'recording' && rec.mode === 'agent') {
      expect(rec.sessions.find((s) => s.id === 's3')?.gone).toBe(true);
    }

    // Wheel skips the gone entry; wheel back would also not auto-pick it. Release with s3 selected.
    await release(env, 'agent');

    expect(env.adapter.sent).toEqual([]);
    const [failure] = env.controller.getState().failures;
    expect(failure).toMatchObject({
      kind: 'session-gone',
      text: 'Hallo Welt',
      target: { id: 's3' },
    });
    expect(phase(env).name).toBe('idle');

    // The user may explicitly pick another session.
    await env.controller.resolveFailure(failure!.id, { type: 'send-to', sessionId: 's5' });
    expect(env.adapter.sent).toEqual([{ sessionId: 's5', text: 'Hallo Welt' }]);
    expect(env.controller.getState().failures).toEqual([]);
  });

  it('5 · failed transcription: Failed(stt), audio kept, retry works', async () => {
    env.stt.results = [new Error('Zeitüberschreitung nach 15 s'), { text: 'Zweiter Versuch' }];
    env.input.emit({ type: 'down', action: 'dictate' });
    await flush();
    env.recorder.feed(64);
    await release(env, 'dictate');

    const [failure] = env.controller.getState().failures;
    expect(failure?.kind).toBe('stt');
    expect(failure?.audio?.data.length).toBe(64);
    expect(env.inserter.inserted).toEqual([]);

    await env.controller.resolveFailure(failure!.id, { type: 'retry' });
    expect(env.stt.calls).toHaveLength(2);
    expect(env.stt.calls[1]).toBe(failure!.audio);
    expect(env.inserter.inserted).toEqual(['Zweiter Versuch']);
    expect(env.controller.getState().failures).toEqual([]);
  });

  it('6 · insert at cursor: text arrives, no Enter, clipboard restored', async () => {
    const clock = new FakeClock();
    const clipboard = new FakeClipboard('vorher kopiert');
    const keys = new FakeKeys(clipboard);
    const inserter = new ClipboardPasteInserter({ clipboard, keys, clock });

    const result = await inserter.insert('Die Migration ist abgeschlossen.');

    expect(result).toEqual({ ok: true });
    expect(keys.field).toBe('Die Migration ist abgeschlossen.');
    expect(keys.sentKeys).toEqual(['Ctrl+V']);
    expect(keys.sentKeys.join()).not.toMatch(/enter|\r|\n/i);
    expect(keys.field).not.toMatch(/[\r\n]$/);

    clock.advance(299);
    await flush();
    expect(clipboard.text).toBe('Die Migration ist abgeschlossen.');
    clock.advance(1);
    await flush();
    expect(clipboard.text).toBe('vorher kopiert');
  });
});
