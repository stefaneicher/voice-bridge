import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  TerminalLauncher,
  type TerminalLauncherOptions,
} from '../../../src/agents/terminal-launcher';

type Call = { command: string; args: string[]; options: Record<string, unknown> };

function setup(files: string[], extra: Partial<TerminalLauncherOptions> = {}, fail = false) {
  const calls: Call[] = [];
  let unrefs = 0;
  const launcher = new TerminalLauncher({
    profile: 'privat',
    appPath: 'C:\\app',
    platform: 'win32',
    env: { PATH: 'C:\\bin;C:\\wt', ComSpec: 'C:\\Windows\\cmd.exe' },
    exists: (p) => files.includes(p),
    spawn: (command, args, options) => {
      calls.push({ command, args, options: options as Record<string, unknown> });
      const child = Object.assign(new EventEmitter(), { unref: () => unrefs++ });
      queueMicrotask(() => (fail ? child.emit('error', new Error('ENOENT')) : child.emit('spawn')));
      return child;
    },
    ...extra,
  });
  return { launcher, calls, unrefs: () => unrefs };
}

const VB = 'C:\\bin\\vb.cmd';
const WT = 'C:\\wt\\wt.exe';
const DIR = 'C:\\work\\voice-bridge';

describe('TerminalLauncher', () => {
  it('opens a Windows Terminal tab with a token-bound vb run', async () => {
    const { launcher, calls, unrefs } = setup([VB, WT, DIR]);
    expect(launcher.available()).toBe(true);
    await launcher.launch(DIR, 'abcd1234');
    expect(calls).toEqual([
      {
        command: WT,
        args: [
          'new-tab',
          '-d',
          DIR,
          VB,
          'run',
          '--profile',
          'privat',
          '--launch',
          'abcd1234',
          '--',
          'copilot',
        ],
        options: { cwd: DIR, detached: true, stdio: 'ignore' },
      },
    ]);
    expect(unrefs()).toBe(1);
  });

  it('passes a folder with ; via the working directory', async () => {
    const dir = 'C:\\a;b';
    const { launcher, calls } = setup([VB, WT, dir]);
    await launcher.launch(dir, 't1');
    expect(calls[0]?.args.slice(0, 3)).toEqual(['new-tab', '-d', '.']);
    expect(calls[0]?.options.cwd).toBe(dir);
  });

  it('falls back to cmd start without Windows Terminal', async () => {
    const { launcher, calls } = setup([VB, DIR]);
    await launcher.launch(DIR, 't1');
    expect(calls[0]).toEqual({
      command: 'C:\\Windows\\cmd.exe',
      args: [`/d /c start "" "${VB}" "run" "--profile" "privat" "--launch" "t1" "--" "copilot"`],
      options: { cwd: DIR, detached: true, stdio: 'ignore', windowsVerbatimArguments: true },
    });
  });

  it('refuses cmd-unsafe paths in the fallback', async () => {
    const vb = 'C:\\a&b\\vb.cmd';
    const { launcher, calls } = setup([vb, DIR], {
      env: { PATH: 'C:\\a&b', ComSpec: 'cmd.exe' },
    });
    await expect(launcher.launch(DIR, 't1')).rejects.toThrow(/nicht sicher/);
    expect(calls).toEqual([]);
  });

  it('uses node with bin/vb.js of a checkout when vb is not on PATH', async () => {
    const node = 'C:\\bin\\node.exe';
    const { launcher, calls } = setup([node, 'C:\\app\\bin\\vb.js', WT, DIR]);
    await launcher.launch(DIR, 't1');
    expect(calls[0]?.args.slice(3, 6)).toEqual([node, 'C:\\app\\bin\\vb.js', 'run']);
  });

  it('is unavailable without vb, inside asar or off Windows', () => {
    expect(setup([WT]).launcher.available()).toBe(false);
    expect(
      setup(['C:\\bin\\node.exe', 'C:\\app.asar\\bin\\vb.js'], {
        appPath: 'C:\\app.asar',
      }).launcher.available(),
    ).toBe(false);
    expect(setup([VB, WT], { platform: 'linux' }).launcher.available()).toBe(false);
  });

  it('rejects when the folder is gone, unavailable or the spawn fails', async () => {
    await expect(setup([VB, WT]).launcher.launch(DIR, 't1')).rejects.toThrow(/Ordner fehlt/);
    await expect(setup([]).launcher.launch(DIR, 't1')).rejects.toThrow(/kein vb/);
    await expect(setup([VB, WT, DIR], {}, true).launcher.launch(DIR, 't1')).rejects.toThrow(
      'ENOENT',
    );
  });

  it('reads Path when PATH is missing', () => {
    const { launcher } = setup([VB], { env: { Path: 'C:\\bin' } });
    expect(launcher.available()).toBe(true);
  });
});
