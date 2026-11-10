import { createServer, type Server } from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';
import type { HotkeyAction } from '../core';
import type { PairingStore } from './pairing';
import {
  REMOTE_PATH,
  REMOTE_PROTOCOL_VERSION,
  parseAppMessage,
  type PcMessage,
  type RemoteTarget,
} from './protocol';
import type { TlsIdentity } from './tls';

/** What the server needs from the app. Implemented in main/remote-bridge.ts. */
export interface RemoteHost {
  readonly pcName: string;
  readonly profile: string;
  listTargets(): Promise<RemoteTarget[]>;
  onTargetsChanged(cb: () => void): () => void;
  /** Starts a recording fed by this client. Returns false if Voice-Bridge is busy. */
  begin(client: RemoteClient, mode: HotkeyAction, target: string | undefined): boolean;
  audio(client: RemoteClient, chunk: Uint8Array): void;
  end(client: RemoteClient): void;
  cancel(client: RemoteClient): void;
}

export interface RemoteClient {
  readonly id: number;
  readonly deviceName: string;
  send(message: PcMessage): void;
}

export interface RemoteServerOptions {
  port: number;
  host?: string;
  identity: TlsIdentity;
  pairing: PairingStore;
  app: RemoteHost;
  log?: (msg: string) => void;
  /** Unauthenticated connections are closed after this time. */
  authTimeoutMs?: number;
}

const MAX_FRAME_BYTES = 64 * 1024;

/**
 * WebSocket server (TLS) for the Android app. Every connection must first pair with a one-time
 * code or say hello with its device token; anything else closes the connection.
 */
export class RemoteServer {
  private https: Server | null = null;
  private wss: WebSocketServer | null = null;
  private seq = 0;
  private readonly clients = new Set<{ client: RemoteClient; ws: WebSocket }>();
  private unsubscribeTargets: (() => void) | null = null;

  constructor(private readonly o: RemoteServerOptions) {}

  get port(): number {
    const addr = this.https?.address();
    return addr && typeof addr === 'object' ? addr.port : this.o.port;
  }

  async start(): Promise<void> {
    const https = createServer({ cert: this.o.identity.cert, key: this.o.identity.key });
    const wss = new WebSocketServer({
      server: https,
      path: REMOTE_PATH,
      maxPayload: MAX_FRAME_BYTES,
    });
    wss.on('connection', (ws) => this.onConnection(ws));
    await new Promise<void>((resolve, reject) => {
      https.once('error', reject);
      https.listen(this.o.port, this.o.host ?? '0.0.0.0', () => {
        https.off('error', reject);
        resolve();
      });
    });
    this.https = https;
    this.wss = wss;
    this.unsubscribeTargets = this.o.app.onTargetsChanged(() => void this.broadcastTargets());
    this.o.log?.(`remote: listening on port ${this.port}`);
  }

  async stop(): Promise<void> {
    this.unsubscribeTargets?.();
    for (const { ws } of this.clients) ws.terminate();
    this.clients.clear();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    await new Promise<void>((r) => (this.https ? this.https.close(() => r()) : r()));
    this.wss = null;
    this.https = null;
  }

  private onConnection(ws: WebSocket): void {
    const id = ++this.seq;
    let entry: { client: RemoteClient; ws: WebSocket } | null = null;
    let recording = false;
    const send = (m: PcMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    const fail = (code: Extract<PcMessage, { t: 'error' }>['code'], message: string) => {
      send({ t: 'error', code, message });
      ws.close(1008, code);
    };
    const authTimer = setTimeout(() => {
      if (!entry) fail('auth', 'Keine Anmeldung');
    }, this.o.authTimeoutMs ?? 10_000);

    const authenticate = (deviceName: string) => {
      clearTimeout(authTimer);
      entry = { client: { id, deviceName, send }, ws };
      this.clients.add(entry);
      this.o.log?.(`remote: ${deviceName} connected`);
      void this.sendTargets(entry.client);
    };

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (entry && recording) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
          this.o.app.audio(entry.client, new Uint8Array(buf));
        }
        return;
      }
      const message = parseAppMessage(data.toString());
      if (!message) return fail('protocol', 'Ungültige Nachricht');

      if (!entry) {
        if (message.t !== 'pair' && message.t !== 'hello') return fail('auth', 'Nicht angemeldet');
        if (message.v !== REMOTE_PROTOCOL_VERSION) {
          return fail('version', 'Bitte App und Voice-Bridge auf die gleiche Version bringen');
        }
        if (message.t === 'pair') {
          const creds = this.o.pairing.redeem(message.code, message.device);
          if (!creds) return fail('pairing', 'Kopplungscode ungültig oder abgelaufen');
          send({ t: 'paired', ...creds, pc: this.o.app.pcName, profile: this.o.app.profile });
          return authenticate(message.device);
        }
        const device = this.o.pairing.verify(message.deviceId, message.token);
        if (!device) return fail('auth', 'Gerät nicht gekoppelt');
        send({ t: 'welcome', pc: this.o.app.pcName, profile: this.o.app.profile });
        return authenticate(device.name);
      }

      switch (message.t) {
        case 'start':
          if (recording) return;
          if (!this.o.app.begin(entry.client, message.mode, message.target)) {
            send({ t: 'error', code: 'busy', message: 'Voice-Bridge ist gerade beschäftigt' });
            return;
          }
          recording = true;
          send({ t: 'status', phase: 'recording' });
          return;
        case 'stop':
          if (!recording) return;
          recording = false;
          this.o.app.end(entry.client);
          return;
        case 'cancel':
          if (!recording) return;
          recording = false;
          this.o.app.cancel(entry.client);
          return;
        case 'ping':
          send({ t: 'pong' });
          return;
        default:
          return;
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!entry) return;
      this.clients.delete(entry);
      // No data loss: a dropped connection ends the recording and processes what arrived.
      if (recording) this.o.app.end(entry.client);
      this.o.log?.(`remote: ${entry.client.deviceName} disconnected`);
    });
    ws.on('error', () => ws.terminate());
  }

  private async sendTargets(client: RemoteClient): Promise<void> {
    client.send({ t: 'targets', sessions: await this.o.app.listTargets() });
  }

  private async broadcastTargets(): Promise<void> {
    if (!this.clients.size) return;
    const sessions = await this.o.app.listTargets();
    for (const { client } of this.clients) client.send({ t: 'targets', sessions });
  }
}
