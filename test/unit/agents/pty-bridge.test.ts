import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyBridgeAdapter } from '../../../src/agents/pty-bridge';
import { createLineDecoder, encode, type Message } from '../../../src/agents/protocol';

const tempPipe = () =>
  process.platform === 'win32'
    ? `\\\\.\\pipe\\vb-unit-${Math.random().toString(16).slice(2)}`
    : join(mkdtempSync(join(tmpdir(), 'vb-')), 's.sock');

async function client(path: string) {
  const socket = net.connect(path);
  await new Promise((r) => socket.once('connect', r));
  const received: Message[] = [];
  socket.on(
    'data',
    createLineDecoder((m) => received.push(m)),
  );
  return { socket, received, send: (m: Message) => socket.write(encode(m)) };
}

const register = (sessionId: string) =>
  ({ type: 'register', version: 1, sessionId, name: sessionId }) as const;

const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('PtyBridgeAdapter', () => {
  let adapter: PtyBridgeAdapter;
  afterEach(() => adapter?.stop());

  it('removes a session on missed heartbeat', async () => {
    const path = tempPipe();
    adapter = new PtyBridgeAdapter({ pipePath: path, heartbeatTimeoutMs: 150 });
    await adapter.start();
    const c = await client(path);
    c.send(register('pty:a'));
    await until(() => adapter['sessions'].size === 1);
    await until(() => adapter['sessions'].size === 0, 2000);
    c.socket.destroy();
  });

  it('reports busy state from heartbeats and removes on bye', async () => {
    const path = tempPipe();
    adapter = new PtyBridgeAdapter({ pipePath: path });
    await adapter.start();
    const changes: string[] = [];
    adapter.onChange((s) => changes.push(s.map((x) => `${x.id}:${x.state}`).join()));
    const c = await client(path);
    c.send(register('pty:a'));
    c.send({ type: 'heartbeat', sessionId: 'pty:a', state: 'busy' });
    c.send({ type: 'bye', sessionId: 'pty:a' });
    await until(() => changes.length === 3);
    expect(changes).toEqual(['pty:a:idle', 'pty:a:busy', '']);
    c.socket.destroy();
  });

  it('keeps launch token and initial state of a launched session', async () => {
    const path = tempPipe();
    adapter = new PtyBridgeAdapter({ pipePath: path });
    await adapter.start();
    const c = await client(path);
    c.send({ ...register('pty:l'), launchToken: 'abcd1234', state: 'busy' });
    await until(() => adapter['sessions'].size === 1);
    expect(await adapter.listSessions()).toMatchObject([
      { id: 'pty:l', launchToken: 'abcd1234', state: 'busy' },
    ]);
    c.socket.destroy();
  });

  it('does not let a second connection take over a session ID', async () => {
    const path = tempPipe();
    adapter = new PtyBridgeAdapter({ pipePath: path });
    await adapter.start();
    const owner = await client(path);
    owner.send(register('pty:a'));
    await until(() => adapter['sessions'].size === 1);
    const intruder = await client(path);
    intruder.send({ ...register('pty:a'), name: 'evil' });
    intruder.send({ type: 'bye', sessionId: 'pty:a' });
    await new Promise((r) => setTimeout(r, 50));
    expect((await adapter.listSessions())[0]?.name).toBe('pty:a');

    const sending = adapter.send('pty:a', 'hallo');
    await until(() => owner.received.length === 1);
    expect(intruder.received).toEqual([]);
    const inject = owner.received[0]!;
    expect(inject).toMatchObject({
      type: 'inject',
      text: 'hallo',
      submit: true,
      bracketedPaste: true,
    });
    // A reply from another connection is ignored.
    if (inject.type === 'inject') {
      intruder.send({ type: 'injectResult', requestId: inject.requestId, ok: false });
      owner.send({ type: 'injectResult', requestId: inject.requestId, ok: true });
    }
    expect(await sending).toEqual({ ok: true });
    owner.socket.destroy();
    intruder.socket.destroy();
  });

  it('fails with io when the wrapper does not answer, and gone when it disconnects', async () => {
    const path = tempPipe();
    adapter = new PtyBridgeAdapter({ pipePath: path, injectTimeoutMs: 100 });
    await adapter.start();
    const c = await client(path);
    c.send(register('pty:a'));
    await until(() => adapter['sessions'].size === 1);
    expect(await adapter.send('pty:a', 'x')).toMatchObject({ ok: false, reason: 'io' });

    const pending = adapter.send('pty:a', 'y');
    c.socket.destroy();
    expect(await pending).toEqual({ ok: false, reason: 'gone' });
    expect(await adapter.send('pty:a', 'z')).toEqual({ ok: false, reason: 'gone' });
  });

  it('fills titles from the lookup, refreshes them and keeps an explicit --title', async () => {
    const path = tempPipe();
    let titles = new Map<number, string>([[11, 'Write Message Function']]);
    const logs: string[] = [];
    let fail = false;
    adapter = new PtyBridgeAdapter({
      pipePath: path,
      titleRefreshMs: 30,
      log: (m) => logs.push(m),
      titleLookup: async (pids) => {
        if (fail) throw new Error('boom');
        return new Map([...titles].filter(([p]) => pids.includes(p)));
      },
    });
    await adapter.start();
    const c = await client(path);
    c.send({ ...register('pty:a'), pid: 11 });
    c.send({ ...register('pty:b'), pid: 22, title: 'Mine' });
    c.send(register('pty:c'));
    const title = async (id: string) =>
      (await adapter.listSessions()).find((s) => s.id === id)?.title;
    await until(() => adapter['sessions'].get('pty:a')?.info.title === 'Write Message Function');

    titles = new Map([
      [11, 'Renamed'],
      [22, 'Ignored'],
    ]);
    await until(() => adapter['sessions'].get('pty:a')?.info.title === 'Renamed');
    expect(await title('pty:b')).toBe('Mine');
    expect(await title('pty:c')).toBeUndefined();

    fail = true;
    await until(() => logs.some((l) => l.includes('title lookup failed')));
    expect(await title('pty:a')).toBe('Renamed');
    c.socket.destroy();
  });

  it('refuses to start when the pipe is in use', async () => {
    const path = tempPipe();
    adapter = new PtyBridgeAdapter({ pipePath: path });
    await adapter.start();
    const second = new PtyBridgeAdapter({ pipePath: path });
    await expect(second.start()).rejects.toThrow();
  });
});
