import { randomBytes } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import net from 'node:net';
import { basename, delimiter, extname, isAbsolute, join } from 'node:path';
import type { SessionState } from '../core';
import {
  PROTOCOL_VERSION,
  createLineDecoder,
  encode,
  ptyPayload,
  type Message,
} from '../agents/protocol';

/** The subset of node-pty used here (injectable for tests). */
export interface Pty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

export type SpawnPty = (
  file: string,
  args: string[],
  opts: { cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; name: string },
) => Pty;

export interface RunOptions {
  command: string;
  args: string[];
  pipePath: string;
  spawn: SpawnPty;
  name?: string;
  title?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: NodeJS.ReadableStream & { setRawMode?: (on: boolean) => unknown; isTTY?: boolean };
  stdout?: NodeJS.WritableStream & {
    columns?: number;
    rows?: number;
    on?: (...a: never[]) => unknown;
  };
  heartbeatMs?: number;
  reconnectMs?: number;
  /** Output silence after which the session counts as idle. */
  idleAfterMs?: number;
  /** Delay between paste and Enter so the TUI can take the paste first. */
  submitDelayMs?: number;
  log?: (msg: string) => void;
}

export interface RunHandle {
  sessionId: string;
  exited: Promise<number>;
  /** Resolves once registered with Voice-Bridge (for tests). */
  registered: Promise<void>;
}

/**
 * `vb run -- <cmd>`: runs the agent in a pseudo console, passes all I/O through 1:1 and registers
 * the session with Voice-Bridge, which can then write prompts into it without focus changes.
 * The agent keeps running if Voice-Bridge is not available; the wrapper reconnects.
 */
export function runWrapped(o: RunOptions): RunHandle {
  const stdin = o.stdin ?? process.stdin;
  const stdout = o.stdout ?? process.stdout;
  const cwd = o.cwd ?? process.cwd();
  const sessionId = `pty:${randomBytes(3).toString('hex')}`;
  const heartbeatMs = o.heartbeatMs ?? 2000;
  const reconnectMs = o.reconnectMs ?? 3000;
  const idleAfterMs = o.idleAfterMs ?? 1500;
  const submitDelayMs = o.submitDelayMs ?? 60;

  const { file, args } = resolveSpawn(o.command, o.args, o.env ?? process.env);
  const pty = o.spawn(file, args, {
    cols: stdout.columns ?? 120,
    rows: stdout.rows ?? 30,
    cwd,
    env: o.env ?? process.env,
    name: 'xterm-256color',
  });

  let lastOutputAt = Date.now();
  let socket: net.Socket | null = null;
  let closed = false;
  let heartbeat: NodeJS.Timeout | null = null;
  let reconnect: NodeJS.Timeout | null = null;
  let markRegistered: () => void = () => {};
  const registered = new Promise<void>((r) => (markRegistered = r));

  // ---- terminal passthrough
  pty.onData((data) => {
    lastOutputAt = Date.now();
    stdout.write(data);
  });
  const onInput = (chunk: Buffer | string) => pty.write(chunk.toString());
  if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true);
  stdin.on('data', onInput);
  stdin.resume?.();
  const onResize = () => {
    if (stdout.columns && stdout.rows) pty.resize(stdout.columns, stdout.rows);
  };
  (stdout as NodeJS.WriteStream).on?.('resize', onResize);

  // ---- bridge connection
  const state = (): SessionState => (Date.now() - lastOutputAt > idleAfterMs ? 'idle' : 'busy');

  const send = (m: Message) => {
    if (socket && !socket.destroyed) socket.write(encode(m));
  };

  const connect = () => {
    if (closed) return;
    const s = net.connect(o.pipePath);
    s.setEncoding('utf8');
    s.on('connect', () => {
      socket = s;
      send({
        type: 'register',
        version: PROTOCOL_VERSION,
        sessionId,
        name: o.name ?? basename(cwd),
        title: o.title,
        cwd,
        command: [o.command, ...o.args].join(' '),
        pid: pty.pid,
      });
      markRegistered();
      heartbeat = setInterval(
        () => send({ type: 'heartbeat', sessionId, state: state() }),
        heartbeatMs,
      );
    });
    s.on(
      'data',
      createLineDecoder((m) => {
        if (m.type !== 'inject' || m.sessionId !== sessionId) return;
        try {
          pty.write(ptyPayload(m.text, m.bracketedPaste));
          if (m.submit) setTimeout(() => pty.write('\r'), submitDelayMs);
          send({ type: 'injectResult', requestId: m.requestId, ok: true });
        } catch (err) {
          send({ type: 'injectResult', requestId: m.requestId, ok: false, error: String(err) });
        }
      }),
    );
    s.on('error', () => {
      /* handled by close */
    });
    s.on('close', () => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      if (socket === s) socket = null;
      if (!closed) reconnect = setTimeout(connect, reconnectMs);
    });
  };
  connect();

  const exited = new Promise<number>((resolve) => {
    pty.onExit(({ exitCode }) => {
      closed = true;
      send({ type: 'bye', sessionId, exitCode });
      if (heartbeat) clearInterval(heartbeat);
      if (reconnect) clearTimeout(reconnect);
      socket?.end();
      stdin.off?.('data', onInput);
      (stdout as NodeJS.WriteStream).off?.('resize', onResize);
      if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(false);
      stdin.pause?.();
      resolve(exitCode);
    });
  });

  return { sessionId, exited, registered };
}

/**
 * Resolves a command like `copilot` via PATH. On Windows, `.cmd`/`.bat` shims (as installed by
 * npm) cannot be started directly by ConPTY and are run through cmd.exe.
 */
export function resolveSpawn(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = isExecutable,
): { file: string; args: string[] } {
  if (platform !== 'win32') return { file: command, args };
  const resolved = findOnPath(command, env, exists) ?? command;
  const ext = extname(resolved).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    return { file: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', resolved, ...args] };
  }
  return { file: resolved, args };
}

function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean,
): string | null {
  const exts = extname(command)
    ? ['']
    : (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const dirs =
    isAbsolute(command) || command.includes('\\') || command.includes('/')
      ? ['']
      : [process.cwd(), ...(env.Path ?? env.PATH ?? '').split(delimiter)];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = dir ? join(dir, command + ext) : command + ext;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
