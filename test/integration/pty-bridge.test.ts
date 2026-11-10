import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { PtyBridgeAdapter } from '../../src/agents/pty-bridge';
import { runWrapped, type SpawnPty } from '../../src/cli/run';
import { AgentRegistry } from '../../src/core';

const require = createRequire(import.meta.url);
const pty = require('node-pty') as { spawn: SpawnPty };
const fixture = join(__dirname, '../fixtures/echo-agent.mjs');

function tempPipe(): string {
  const id = Math.random().toString(16).slice(2);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\vb-test-${id}`
    : join(mkdtempSync(join(tmpdir(), 'vb-')), 's.sock');
}

class Capture extends Writable {
  text = '';
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.text += chunk.toString();
    cb();
  }
}

async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('vb run ↔ PtyBridgeAdapter (integration)', () => {
  let adapter: PtyBridgeAdapter | null = null;
  afterEach(async () => {
    await adapter?.stop();
    adapter = null;
  });

  it('registers, receives an injected prompt with Enter and unregisters on exit', async () => {
    const path = tempPipe();
    adapter = new PtyBridgeAdapter({ pipePath: path, bracketedPaste: true, pressEnter: true });
    await adapter.start();
    const registry = new AgentRegistry([adapter]);

    const stdin = new PassThrough();
    const stdout = new Capture();
    const handle = runWrapped({
      command: process.execPath,
      args: [fixture],
      name: 'echo',
      pipePath: path,
      spawn: pty.spawn,
      stdin,
      stdout,
    });
    await handle.registered;
    await waitFor(() => stdout.text.includes('bereit'));

    const sessions = await waitFor(async () => {
      const list = await registry.listSessions();
      return list.length ? list : null;
    });
    expect(sessions[0]).toMatchObject({
      id: handle.sessionId,
      name: 'echo',
      adapterId: 'pty-bridge',
    });

    const result = await registry.send(handle.sessionId, 'Bitte die Tests reparieren');
    expect(result).toEqual({ ok: true });
    await waitFor(() => stdout.text.includes('ECHO:Bitte die Tests reparieren'));

    // Unknown IDs are never redirected.
    expect(await registry.send('pty:nope', 'x')).toEqual({ ok: false, reason: 'gone' });

    // Typed input is passed through 1:1.
    stdin.write('exit\r');
    expect(await handle.exited).toBe(0);
    await waitFor(async () => (await registry.listSessions()).length === 0);
  });

  it('keeps the agent running and connects once Voice-Bridge starts later', async () => {
    const path = tempPipe();
    const stdin = new PassThrough();
    const stdout = new Capture();
    const handle = runWrapped({
      command: process.execPath,
      args: [fixture],
      pipePath: path,
      spawn: pty.spawn,
      stdin,
      stdout,
      reconnectMs: 100,
    });
    await waitFor(() => stdout.text.includes('bereit'));

    adapter = new PtyBridgeAdapter({ pipePath: path });
    await adapter.start();
    await handle.registered;
    await waitFor(async () => (await adapter!.listSessions()).length === 1);

    stdin.write('exit\r');
    await handle.exited;
  });
});
