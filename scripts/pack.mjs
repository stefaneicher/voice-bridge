// Builds the npm tarball. In the repo Electron is a devDependency (electron-builder requires that);
// the published package launches the app with Electron, so it becomes a runtime dependency here.
// Usage: node scripts/pack.mjs [destination]   → prints the tarball path
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dest = resolve(process.argv[2] ?? 'dist-npm');
const original = readFileSync('package.json', 'utf8');
const pkg = JSON.parse(original);
pkg.dependencies = { ...pkg.dependencies, electron: pkg.devDependencies.electron };
delete pkg.devDependencies.electron;
delete pkg.scripts.prepare; // husky is a development hook, not for package consumers

mkdirSync(dest, { recursive: true });
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const shell = process.platform === 'win32';
  // Build first (logs to stderr), then pack without lifecycle scripts so stdout stays pure JSON.
  execFileSync(npm, ['run', 'build'], { stdio: ['ignore', process.stderr, 'inherit'], shell });
  const out = execFileSync(
    npm,
    ['pack', '--json', '--ignore-scripts', '--pack-destination', dest],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      shell,
    },
  );
  const [{ filename }] = JSON.parse(out);
  console.log(resolve(dest, filename));
} finally {
  writeFileSync('package.json', original);
}
