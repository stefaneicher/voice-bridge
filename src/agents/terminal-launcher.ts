import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import type { SessionLauncher } from '../core';

type Spawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => {
  once(event: 'spawn', cb: () => void): unknown;
  once(event: 'error', cb: (err: Error) => void): unknown;
  unref(): void;
};

export interface TerminalLauncherOptions {
  /** Voice-Bridge profile; the new `vb run` must register on the same pipe. */
  profile: string;
  /** App directory; in development `bin/vb.js` lives there. */
  appPath: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  spawn?: Spawn;
}

// Characters cmd.exe would interpret even inside quotes, or that break the quoting.
const CMD_UNSAFE = /["%&|<>^\r\n]/;

/**
 * Opens a new terminal tab running `vb run --launch <token> -- copilot` in a folder (T-026,
 * ADR-017). Windows Terminal first, `cmd /c start` as fallback. Windows only.
 */
export class TerminalLauncher implements SessionLauncher {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly exists: (path: string) => boolean;
  private readonly spawn: Spawn;
  private resolved: { vb: string[]; wt: string | null } | null | undefined;

  constructor(private readonly o: TerminalLauncherOptions) {
    this.platform = o.platform ?? process.platform;
    this.env = o.env ?? process.env;
    this.exists = o.exists ?? existsSync;
    this.spawn = o.spawn ?? (nodeSpawn as unknown as Spawn);
  }

  available(): boolean {
    return this.resolve() !== null;
  }

  launch(folder: string, token: string): Promise<void> {
    const r = this.resolve();
    if (!r) return Promise.reject(new Error('Kein Terminal oder kein vb gefunden'));
    if (!this.exists(folder)) return Promise.reject(new Error(`Ordner fehlt: ${folder}`));
    const vbArgs = [
      ...r.vb,
      'run',
      '--profile',
      this.o.profile,
      '--launch',
      token,
      '--',
      'copilot',
    ];
    if (r.wt) {
      // ';' separates wt commands, so such a folder is passed via the working directory.
      const dir = folder.includes(';') ? '.' : folder;
      return this.start(r.wt, ['new-tab', '-d', dir, ...vbArgs], {
        cwd: folder,
        detached: true,
        stdio: 'ignore',
      });
    }
    if (vbArgs.some((a) => CMD_UNSAFE.test(a))) {
      return Promise.reject(new Error('Pfad für cmd nicht sicher darstellbar'));
    }
    const comspec = this.env.ComSpec || 'cmd.exe';
    // `start` takes the folder from the working directory, never from the command string.
    const line = ['/d', '/c', 'start', '""', ...vbArgs.map((a) => `"${a}"`)].join(' ');
    return this.start(comspec, [line], {
      cwd: folder,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    });
  }

  private start(command: string, args: string[], options: SpawnOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawn(command, args, options);
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  private resolve(): { vb: string[]; wt: string | null } | null {
    if (this.resolved !== undefined) return this.resolved;
    this.resolved = null;
    if (this.platform !== 'win32') return null;
    const vb = this.findVb();
    if (!vb) return null;
    this.resolved = { vb, wt: this.which(['wt.exe']) };
    return this.resolved;
  }

  /** `vb` from PATH (npm link / global install), else `node bin/vb.js` of this checkout. */
  private findVb(): string[] | null {
    const onPath = this.which(['vb.cmd', 'vb.exe', 'vb.bat']);
    if (onPath) return [onPath];
    const script = win32.join(this.o.appPath, 'bin', 'vb.js');
    const node = this.which(['node.exe']);
    // Inside an asar archive the script is not runnable by a plain node.
    if (node && !this.o.appPath.includes('.asar') && this.exists(script)) return [node, script];
    return null;
  }

  private which(names: string[]): string | null {
    const dirs = (this.env.PATH ?? this.env.Path ?? '').split(win32.delimiter).filter(Boolean);
    for (const dir of dirs) {
      for (const name of names) {
        const full = win32.join(dir, name);
        if (this.exists(full)) return full;
      }
    }
    return null;
  }
}
