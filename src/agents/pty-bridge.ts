import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import type { AgentAdapter, DeliveryResult, SessionInfo, Unsubscribe } from '../core';
import { PROTOCOL_VERSION, createLineDecoder, encode, type Message } from './protocol';

export interface PtyBridgeOptions {
  pipePath: string;
  heartbeatTimeoutMs?: number;
  injectTimeoutMs?: number;
  bracketedPaste?: boolean;
  pressEnter?: boolean;
  log?: (msg: string) => void;
}

interface Entry {
  info: SessionInfo;
  socket: net.Socket;
  lastBeat: number;
}

interface Pending {
  resolve: (r: DeliveryResult) => void;
  timer: NodeJS.Timeout;
  sessionId: string;
}

/**
 * Server side of `vb run`: wrappers register their PTY sessions over a named pipe / unix socket.
 * A session is gone on `bye`, on a closed connection or after a missed heartbeat.
 */
export class PtyBridgeAdapter implements AgentAdapter {
  readonly id = 'pty-bridge';
  private readonly sessions = new Map<string, Entry>();
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(s: SessionInfo[]) => void>();
  private server: net.Server | null = null;
  private sweeper: NodeJS.Timeout | null = null;
  private readonly heartbeatTimeoutMs: number;
  private readonly injectTimeoutMs: number;

  constructor(private readonly o: PtyBridgeOptions) {
    this.heartbeatTimeoutMs = o.heartbeatTimeoutMs ?? 5000;
    this.injectTimeoutMs = o.injectTimeoutMs ?? 3000;
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (process.platform !== 'win32' && existsSync(this.o.pipePath)) {
      if (await isListening(this.o.pipePath)) {
        throw new Error(`Pipe ${this.o.pipePath} ist bereits belegt (läuft das Profil schon?)`);
      }
      unlinkSync(this.o.pipePath);
    }
    const server = net.createServer((socket) => this.onConnection(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.o.pipePath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.sweeper = setInterval(() => this.sweep(), Math.min(1000, this.heartbeatTimeoutMs / 2));
    this.sweeper.unref();
  }

  async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const e of this.sessions.values()) e.socket.destroy();
    this.sessions.clear();
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, reason: 'gone' });
      this.pending.delete(id);
    }
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  async listSessions(): Promise<SessionInfo[]> {
    return this.snapshot();
  }

  onChange(cb: (s: SessionInfo[]) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  send(sessionId: string, text: string): Promise<DeliveryResult> {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.socket.destroyed) return Promise.resolve({ ok: false, reason: 'gone' });
    const requestId = randomUUID();
    return new Promise<DeliveryResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, reason: 'io', detail: 'Keine Antwort von der Session' });
      }, this.injectTimeoutMs);
      this.pending.set(requestId, { resolve, timer, sessionId });
      entry.socket.write(
        encode({
          type: 'inject',
          sessionId,
          requestId,
          text,
          submit: this.o.pressEnter ?? true,
          bracketedPaste: this.o.bracketedPaste ?? true,
        }),
      );
    });
  }

  private onConnection(socket: net.Socket): void {
    const owned = new Set<string>();
    const decode = createLineDecoder(
      (m) => this.onMessage(socket, owned, m),
      (reason) => this.o.log?.(`pty-bridge: ignored message (${reason})`),
    );
    socket.setEncoding('utf8');
    socket.on('data', decode);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      for (const id of owned) this.removeSession(id);
    });
  }

  private onMessage(socket: net.Socket, owned: Set<string>, m: Message): void {
    switch (m.type) {
      case 'register': {
        if (m.version !== PROTOCOL_VERSION) {
          this.o.log?.(`pty-bridge: unsupported protocol version ${m.version}`);
          return;
        }
        const existing = this.sessions.get(m.sessionId);
        if (existing && existing.socket !== socket) return; // IDs cannot be taken over
        owned.add(m.sessionId);
        this.sessions.set(m.sessionId, {
          socket,
          lastBeat: Date.now(),
          info: {
            id: m.sessionId,
            adapterId: this.id,
            name: m.name,
            title: m.title,
            cwd: m.cwd,
            command: m.command,
            pid: m.pid,
            state: 'idle',
            lastActivity: new Date().toISOString(),
          },
        });
        this.o.log?.(`pty-bridge: session ${m.sessionId} registered (${m.name})`);
        this.emit();
        return;
      }
      case 'heartbeat': {
        const e = this.sessions.get(m.sessionId);
        if (!e || e.socket !== socket) return;
        e.lastBeat = Date.now();
        if (e.info.state !== m.state) {
          e.info = { ...e.info, state: m.state, lastActivity: new Date().toISOString() };
          this.emit();
        }
        return;
      }
      case 'bye':
        if (owned.has(m.sessionId)) this.removeSession(m.sessionId);
        return;
      case 'injectResult': {
        const p = this.pending.get(m.requestId);
        if (!p || !owned.has(p.sessionId)) return;
        clearTimeout(p.timer);
        this.pending.delete(m.requestId);
        p.resolve(m.ok ? { ok: true } : { ok: false, reason: 'io', detail: m.error });
        return;
      }
      default:
        return;
    }
  }

  private removeSession(id: string): void {
    if (!this.sessions.delete(id)) return;
    this.o.log?.(`pty-bridge: session ${id} closed`);
    for (const [rid, p] of this.pending) {
      if (p.sessionId !== id) continue;
      clearTimeout(p.timer);
      this.pending.delete(rid);
      p.resolve({ ok: false, reason: 'gone' });
    }
    this.emit();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, e] of this.sessions) {
      if (now - e.lastBeat > this.heartbeatTimeoutMs) {
        this.o.log?.(`pty-bridge: session ${id} missed heartbeat`);
        this.removeSession(id);
      }
    }
  }

  private snapshot(): SessionInfo[] {
    return [...this.sessions.values()].map((e) => e.info);
  }

  private emit(): void {
    const list = this.snapshot();
    for (const l of this.listeners) l(list);
  }
}

function isListening(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(path);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}
