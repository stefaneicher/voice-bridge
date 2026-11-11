import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encode } from '../../src/agents/protocol';
import { pipePath } from '../../src/agents/pipe';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as unknown as string;
const root = join(import.meta.dirname, '../..');
const PROFILE = 'e2e';

let app: ElectronApplication;
let dir: string;
const pageErrors: string[] = [];

async function until<T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 200));
  }
}

const windowUrls = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => w.webContents.getURL()),
  );

describe('Electron app (smoke)', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vb-e2e-'));
    // Isolate config, data and the pipe from the developer's real profile.
    process.env.XDG_RUNTIME_DIR = dir;
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: dir,
      APPDATA: dir,
      XDG_RUNTIME_DIR: dir,
    } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: electronPath,
      args: [root, '--no-sandbox', '--profile', PROFILE],
      env,
    });
    app.on('window', (page) => page.on('pageerror', (e) => pageErrors.push(e.message)));
  });

  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens the Agent Desk and creates the overlays and the recorder once at startup', async () => {
    const urls = await until(async () => {
      const list = await windowUrls();
      return list.length >= 5 ? list : undefined;
    });
    const views = urls.map((u) => u.split('#')[1]).sort();
    expect(views).toEqual(['desk', 'pill', 'popup', 'recorder', 'toast']);
  });

  it('accepts a vb run session on the profile pipe', async () => {
    const path = pipePath(PROFILE);
    const socket = await until(
      () =>
        new Promise<net.Socket | undefined>((resolve) => {
          const s = net.connect(path);
          s.once('connect', () => resolve(s));
          s.once('error', () => resolve(undefined));
        }),
    );
    socket.write(encode({ type: 'register', version: 1, sessionId: 'pty:e2e', name: 'e2e-agent' }));
    socket.write(encode({ type: 'bye', sessionId: 'pty:e2e' }));
    socket.end();
  });

  it('shows the Agent Desk when started a second time (single instance per profile)', async () => {
    const second = spawn(electronPath, [root, '--no-sandbox', '--profile', PROFILE], {
      env: { ...process.env, XDG_CONFIG_HOME: dir, APPDATA: dir, XDG_RUNTIME_DIR: dir },
      stdio: 'ignore',
    });
    const code = await new Promise<number | null>((r) => second.on('exit', r));
    expect(code).toBe(0);

    const desk = await until(async () => app.windows().find((p) => p.url().endsWith('#desk')));
    await desk.waitForSelector('text=Profil e2e');
    expect(await desk.title()).toBe('Agent Desk');
  });

  it('renders without page errors', () => {
    expect(pageErrors).toEqual([]);
  });
});
