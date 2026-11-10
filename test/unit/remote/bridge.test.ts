import { describe, expect, it } from 'vitest';
import { AgentRegistry, SessionController } from '../../../src/core';
import { MergedInput } from '../../../src/input/merged';
import { RemoteBridge } from '../../../src/remote/bridge';
import type { PcMessage } from '../../../src/remote/protocol';
import { SwitchingRecorder } from '../../../src/remote/remote-recorder';
import type { RemoteClient } from '../../../src/remote/server';
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
  const platform = new FakeInput();
  const input = new MergedInput(platform);
  const local = new FakeRecorder();
  const recorder = new SwitchingRecorder(local);
  const stt = new FakeStt();
  const inserter = new FakeInserter();
  const adapter = new FakeAdapter([session(1), session(2)]);
  const agents = new AgentRegistry([adapter]);
  const controller = new SessionController({ input, recorder, stt, inserter, agents, clock });
  const bridge = new RemoteBridge({
    pcName: 'PC',
    profile: 'privat',
    controller,
    agents,
    recorder,
    emit: (e) => input.emit(e),
  });
  const sent: PcMessage[] = [];
  const client: RemoteClient = { id: 1, deviceName: 'Pixel', send: (m) => sent.push(m) };
  return {
    clock,
    platform,
    local,
    recorder,
    stt,
    inserter,
    adapter,
    controller,
    bridge,
    client,
    sent,
  };
}

describe('RemoteBridge', () => {
  it('sends a phone prompt to the session chosen on the phone', async () => {
    const t = setup();
    expect(t.bridge.begin(t.client, 'agent', 's2')).toBe(true);
    await flush();
    expect(t.local.starts).toBe(0); // the PC microphone stays off
    t.bridge.audio(t.client, new Uint8Array(3200));
    t.clock.advance(500);
    t.bridge.end(t.client);
    await flush();

    expect(t.stt.calls[0]!.data.length).toBe(44 + 3200);
    expect(t.adapter.sent).toEqual([{ sessionId: 's2', text: 'Hallo Welt' }]);
    expect(t.sent.at(-1)).toEqual({
      t: 'result',
      ok: true,
      text: 'Hallo Welt',
      target: 'session-2',
    });
    expect(t.recorder.isRemote).toBe(false);
  });

  it('dictates at the PC cursor', async () => {
    const t = setup();
    t.bridge.begin(t.client, 'dictate', undefined);
    t.clock.advance(500);
    t.bridge.end(t.client);
    await flush();
    expect(t.inserter.inserted).toEqual(['Hallo Welt']);
    expect(t.sent.at(-1)).toMatchObject({ t: 'result', ok: true });
  });

  it('reports failures to the phone and keeps the text on the PC', async () => {
    const t = setup();
    t.bridge.begin(t.client, 'agent', 's1');
    t.adapter.remove('s1');
    t.clock.advance(500);
    t.bridge.end(t.client);
    await flush();
    expect(t.sent.at(-1)).toMatchObject({
      t: 'result',
      ok: false,
      kind: 'session-gone',
      text: 'Hallo Welt',
    });
    expect(t.controller.getState().failures).toHaveLength(1);
  });

  it('refuses a second recording while busy', async () => {
    const t = setup();
    t.platform.emit({ type: 'down', action: 'dictate' });
    await flush();
    expect(t.bridge.begin(t.client, 'agent', 's1')).toBe(false);
    expect(t.recorder.isRemote).toBe(false);
  });

  it('cancels without processing and reports idle for too-short presses', async () => {
    const t = setup();
    t.bridge.begin(t.client, 'dictate', undefined);
    t.bridge.cancel(t.client);
    await flush();
    expect(t.stt.calls).toHaveLength(0);
    expect(t.sent.at(-1)).toEqual({ t: 'status', phase: 'idle' });

    t.bridge.begin(t.client, 'dictate', undefined);
    t.clock.advance(100);
    t.bridge.end(t.client);
    await flush();
    expect(t.sent.at(-1)).toEqual({ t: 'status', phase: 'idle' });
    expect(t.recorder.isRemote).toBe(false);
  });

  it('lists targets for the phone', async () => {
    const t = setup();
    expect(await t.bridge.listTargets()).toEqual([
      { id: 's1', name: 'session-1', state: 'idle' },
      { id: 's2', name: 'session-2', state: 'idle' },
    ]);
  });
});
