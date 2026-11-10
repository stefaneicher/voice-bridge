import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../../src/core';
import { FakeAdapter, flush, session } from '../../fakes';

describe('AgentRegistry', () => {
  it('merges sessions of all adapters and routes by adapter', async () => {
    const a = new FakeAdapter([session(1)], 'a');
    const b = new FakeAdapter([session(2, { adapterId: 'b' })], 'b');
    a.sessions[0]!.adapterId = 'a';
    const reg = new AgentRegistry([a, b]);
    expect((await reg.listSessions()).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(await reg.send('s2', 'hi')).toEqual({ ok: true });
    expect(b.sent).toEqual([{ sessionId: 's2', text: 'hi' }]);
    expect(a.sent).toEqual([]);
  });

  it('reports unknown sessions as gone', async () => {
    const reg = new AgentRegistry([new FakeAdapter([session(1)])]);
    expect(await reg.send('nope', 'x')).toEqual({ ok: false, reason: 'gone' });
  });

  it('survives a failing adapter', async () => {
    const broken = new FakeAdapter([], 'broken');
    broken.listSessions = () => Promise.reject(new Error('boom'));
    const reg = new AgentRegistry([broken, new FakeAdapter([session(1)])]);
    expect(await reg.listSessions()).toHaveLength(1);
  });

  it('turns a throwing send into an io failure', async () => {
    const a = new FakeAdapter([session(1)]);
    a.send = () => Promise.reject(new Error('pipe broken'));
    const reg = new AgentRegistry([a]);
    expect(await reg.send('s1', 'x')).toEqual({ ok: false, reason: 'io', detail: 'pipe broken' });
  });

  it('notifies with the full list on changes', async () => {
    const a = new FakeAdapter([session(1)]);
    const reg = new AgentRegistry([a]);
    const seen: string[][] = [];
    const off = reg.onChange((s) => seen.push(s.map((x) => x.id)));
    a.setSessions([session(1), session(2)]);
    await flush();
    off();
    a.setSessions([]);
    await flush();
    expect(seen).toEqual([['s1', 's2']]);
  });
});
