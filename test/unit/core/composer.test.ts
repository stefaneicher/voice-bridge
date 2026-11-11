import { describe, expect, it } from 'vitest';
import {
  AgentRegistry,
  NEW_SESSION_ID,
  PromptHistory,
  RoutedInserter,
  SessionController,
  insertAtCaret,
} from '../../../src/core';
import {
  FakeAdapter,
  FakeClock,
  FakeInput,
  FakeInserter,
  FakeRecorder,
  FakeStt,
  session,
} from '../../fakes';

describe('PromptHistory', () => {
  it('keeps newest first, trims and skips empty and repeated prompts', () => {
    const h = new PromptHistory(3);
    h.add(' a ');
    h.add('');
    h.add('b');
    h.add('b');
    h.add('c');
    h.add('d');
    expect(h.entries).toEqual(['d', 'c', 'b']);
  });

  it('walks older and newer like a shell history', () => {
    const h = new PromptHistory();
    expect(h.older()).toBeUndefined();
    expect(h.newer()).toBeUndefined();
    h.add('first');
    h.add('second');
    expect(h.older()).toBe('second');
    expect(h.older()).toBe('first');
    expect(h.older()).toBeUndefined();
    expect(h.newer()).toBe('second');
    expect(h.newer()).toBe('');
    expect(h.newer()).toBeUndefined();
    h.older();
    h.resetCursor();
    expect(h.older()).toBe('second');
  });

  it('loads entries from elsewhere and restarts the walk', () => {
    const h = new PromptHistory(2);
    h.add('x');
    h.older();
    h.load(['n', 'm', 'o']);
    expect(h.entries).toEqual(['n', 'm']);
    expect(h.older()).toBe('n');
  });
});

describe('insertAtCaret', () => {
  it('inserts at the caret and separates words', () => {
    expect(insertAtCaret('', 0, 0, 'hallo')).toEqual({ value: 'hallo', caret: 5 });
    expect(insertAtCaret('Bitte prüfen', 5, 5, 'genau')).toEqual({
      value: 'Bitte genau prüfen',
      caret: 11,
    });
    expect(insertAtCaret('a ', 2, 2, 'b')).toEqual({ value: 'a b', caret: 3 });
    expect(insertAtCaret('a', 1, 1, ' b')).toEqual({ value: 'a b', caret: 3 });
  });

  it('replaces a selection', () => {
    expect(insertAtCaret('eins zwei drei', 5, 9, 'vier')).toEqual({
      value: 'eins vier drei',
      caret: 9,
    });
  });
});

describe('RoutedInserter', () => {
  it('sends dictation to the composer while it is active', async () => {
    const fallback = new FakeInserter();
    const got: string[] = [];
    const r = new RoutedInserter(
      fallback,
      () => true,
      (t) => (got.push(t), true),
    );
    expect(await r.insert('hallo')).toEqual({ ok: true });
    expect(got).toEqual(['hallo']);
    expect(fallback.inserted).toEqual([]);
  });

  it('pastes at the cursor when the composer is inactive or unreachable', async () => {
    const fallback = new FakeInserter();
    let active = false;
    const r = new RoutedInserter(
      fallback,
      () => active,
      () => false,
    );
    await r.insert('eins');
    active = true;
    await r.insert('zwei');
    expect(fallback.inserted).toEqual(['eins', 'zwei']);
  });
});

function setup() {
  const adapter = new FakeAdapter([session(1), session(2)]);
  const controller = new SessionController({
    input: new FakeInput(),
    recorder: new FakeRecorder(),
    stt: new FakeStt(),
    inserter: new FakeInserter(),
    agents: new AgentRegistry([adapter]),
    clock: new FakeClock(),
  });
  return { adapter, controller };
}

describe('SessionController.sendText', () => {
  it('sends to exactly the given session and pins it', async () => {
    const { adapter, controller } = setup();
    expect(await controller.sendText('s2', 'Tests ausführen')).toEqual({ ok: true });
    expect(adapter.sent).toEqual([{ sessionId: 's2', text: 'Tests ausführen' }]);
    expect(controller.getState().lastSessionId).toBe('s2');
    expect(controller.getState().phase.name).toBe('idle');
  });

  it('refuses without text or target', async () => {
    const { adapter, controller } = setup();
    expect(await controller.sendText('s1', '  ')).toMatchObject({ ok: false });
    expect(await controller.sendText(undefined, 'x')).toMatchObject({
      ok: false,
      message: expect.stringContaining('Keine Ziel-Session'),
    });
    expect(await controller.sendText(NEW_SESSION_ID, 'x')).toMatchObject({ ok: false });
    expect(adapter.sent).toEqual([]);
  });

  it('never reroutes when the session is gone', async () => {
    const { adapter, controller } = setup();
    controller.pinSession('s1');
    adapter.remove('s1');
    const r = await controller.sendText('s1', 'x');
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('getrennt') });
    expect(adapter.sent).toEqual([]);
    expect(controller.getState().failures).toEqual([]);
  });

  it('names busy and I/O errors', async () => {
    const { adapter, controller } = setup();
    adapter.nextResult = { ok: false, reason: 'busy' };
    expect(await controller.sendText('s1', 'x')).toMatchObject({
      message: 'Senden fehlgeschlagen: Session ist beschäftigt.',
    });
    adapter.nextResult = { ok: false, reason: 'io', detail: 'Pipe zu' };
    expect(await controller.sendText('s1', 'x')).toMatchObject({
      message: 'Senden fehlgeschlagen: Pipe zu.',
    });
    adapter.nextResult = { ok: false, reason: 'io' };
    expect(await controller.sendText('s1', 'x')).toMatchObject({
      message: 'Senden fehlgeschlagen: E/A-Fehler.',
    });
  });
});
