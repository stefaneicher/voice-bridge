import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PeerCertificate } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { type ClientOptions } from 'ws';
import { PairingStore, type PairedDevice } from '../../src/remote/pairing';
import type { AppMessage, PcMessage } from '../../src/remote/protocol';
import { RemoteServer, type RemoteClient, type RemoteHost } from '../../src/remote/server';
import { loadOrCreateIdentity, type TlsIdentity } from '../../src/remote/tls';

class FakeHost implements RemoteHost {
  readonly pcName = 'Büro-PC';
  readonly profile = 'privat';
  calls: string[] = [];
  bytes = 0;
  busy = false;
  async listTargets() {
    return [{ id: 'pty:1', name: 'billing-service', state: 'idle' as const }];
  }
  onTargetsChanged() {
    return () => {};
  }
  begin(_c: RemoteClient, mode: string, target?: string) {
    this.calls.push(`begin:${mode}:${target ?? '-'}`);
    return !this.busy;
  }
  audio(_c: RemoteClient, chunk: Uint8Array) {
    this.bytes += chunk.length;
  }
  end() {
    this.calls.push('end');
  }
  cancel() {
    this.calls.push('cancel');
  }
}

let identity: TlsIdentity;
let server: RemoteServer;
let pairing: PairingStore;
const host = new FakeHost();

/** Connects like the app: no CA, but the certificate fingerprint must match the pinned one. */
async function connect(): Promise<{
  ws: WebSocket;
  next: () => Promise<PcMessage>;
  closed: Promise<number>;
}> {
  const ws = new WebSocket(`wss://127.0.0.1:${server.port}/vb`, {
    // Like the app: trust exactly this certificate, checked by its fingerprint.
    ca: identity.cert,
    // ws types this callback differently from Node's tls, which is what actually calls it.
    checkServerIdentity: ((_host: string, cert: PeerCertificate) =>
      cert.fingerprint256.replace(/:/g, '').toLowerCase() === identity.fingerprint
        ? undefined
        : new Error('fingerprint mismatch')) as unknown as ClientOptions['checkServerIdentity'],
  });
  const queue: PcMessage[] = [];
  const waiters: ((m: PcMessage) => void)[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as PcMessage;
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const next = () =>
    queue.length ? Promise.resolve(queue.shift()!) : new Promise<PcMessage>((r) => waiters.push(r));
  return { ws, next, closed };
}

const send = (ws: WebSocket, m: AppMessage) => ws.send(JSON.stringify(m));

describe('RemoteServer (TLS + WebSocket)', () => {
  beforeAll(async () => {
    identity = await loadOrCreateIdentity(mkdtempSync(join(tmpdir(), 'vb-tls-')));
    let saved: PairedDevice[] = [];
    pairing = new PairingStore({ load: () => saved, save: (d) => (saved = d) });
    server = new RemoteServer({
      port: 0,
      host: '127.0.0.1',
      identity,
      pairing,
      app: host,
      authTimeoutMs: 500,
    });
    await server.start();
  });
  afterAll(() => server.stop());

  it('pairs with a one-time code, then logs in with the token and streams a recording', async () => {
    const code = pairing.newCode();
    const a = await connect();
    send(a.ws, { t: 'pair', v: 1, code, device: 'Pixel 9' });
    const paired = await a.next();
    expect(paired).toMatchObject({ t: 'paired', pc: 'Büro-PC', profile: 'privat' });
    expect(await a.next()).toMatchObject({ t: 'targets', sessions: [{ id: 'pty:1' }] });
    a.ws.close();

    if (paired.t !== 'paired') throw new Error('not paired');
    const b = await connect();
    send(b.ws, { t: 'hello', v: 1, deviceId: paired.deviceId, token: paired.token });
    expect(await b.next()).toEqual({ t: 'welcome', pc: 'Büro-PC', profile: 'privat' });
    expect((await b.next()).t).toBe('targets');

    send(b.ws, { t: 'start', mode: 'agent', target: 'pty:1' });
    expect(await b.next()).toEqual({ t: 'status', phase: 'recording' });
    b.ws.send(Buffer.alloc(640));
    b.ws.send(Buffer.alloc(640));
    send(b.ws, { t: 'stop' });
    send(b.ws, { t: 'ping' });
    expect(await b.next()).toEqual({ t: 'pong' });
    expect(host.calls).toEqual(['begin:agent:pty:1', 'end']);
    expect(host.bytes).toBe(1280);

    host.busy = true;
    send(b.ws, { t: 'start', mode: 'dictate' });
    expect(await b.next()).toMatchObject({ t: 'error', code: 'busy' });
    host.busy = false;
    b.ws.close();
  });

  it('rejects a wrong code, a wrong token and anything before login', async () => {
    pairing.newCode();
    const a = await connect();
    send(a.ws, { t: 'pair', v: 1, code: 'guess', device: 'x' });
    expect(await a.next()).toMatchObject({ t: 'error', code: 'pairing' });
    expect(await a.closed).toBe(1008);

    const b = await connect();
    send(b.ws, { t: 'hello', v: 1, deviceId: 'nope', token: 'nope' });
    expect(await b.next()).toMatchObject({ t: 'error', code: 'auth' });

    const c = await connect();
    send(c.ws, { t: 'start', mode: 'dictate' });
    expect(await c.next()).toMatchObject({ t: 'error', code: 'auth' });

    const d = await connect();
    expect(await d.next()).toMatchObject({ t: 'error', code: 'auth' }); // login timeout
  });

  it('cannot be reached when the pinned fingerprint does not match', async () => {
    const ws = new WebSocket(`wss://127.0.0.1:${server.port}/vb`, {
      ca: identity.cert,
      checkServerIdentity: (() =>
        new Error('fingerprint mismatch')) as unknown as ClientOptions['checkServerIdentity'],
    });
    const error = await new Promise<Error>((resolve) => ws.once('error', resolve));
    expect(error.message).toContain('fingerprint mismatch');
  });

  it('rejects other protocol versions', async () => {
    const a = await connect();
    send(a.ws, { t: 'hello', v: 99, deviceId: 'd', token: 't' });
    expect(await a.next()).toMatchObject({ t: 'error', code: 'version' });
  });
});
