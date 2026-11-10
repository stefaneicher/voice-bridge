import { chmodSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { SpawnPty } from './run';

const nodeRequire = createRequire(import.meta.url);

/**
 * Loads node-pty. On macOS the prebuilt `spawn-helper` can lose its execute bit during
 * `npm install`, which makes every spawn fail with "posix_spawnp failed"; restore it.
 */
export function loadNodePty(): { spawn: SpawnPty } {
  if (process.platform === 'darwin') {
    try {
      const root = dirname(nodeRequire.resolve('node-pty/package.json'));
      for (const dir of [`prebuilds/darwin-${process.arch}`, 'build/Release']) {
        const helper = join(root, dir, 'spawn-helper');
        if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755);
      }
    } catch {
      // Best effort: spawning will report the real problem.
    }
  }
  return nodeRequire('node-pty') as { spawn: SpawnPty };
}
