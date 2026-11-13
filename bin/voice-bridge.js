#!/usr/bin/env node
// Starts the Voice-Bridge tray app with the Electron runtime installed alongside this package.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`Voice-Bridge – Push-to-Talk-Spracheingabe

Verwendung:
  voice-bridge [--profile <name>] [--background]

Optionen:
  --profile <name>  Profil (Standard: $VB_PROFILE oder "privat")
  --background      Im Hintergrund starten und das Terminal freigeben

Agents verbinden:  vb run -- copilot
`);
  process.exit(0);
}

let electron;
try {
  electron = require('electron');
} catch {
  process.stderr.write(
    'voice-bridge: Electron wurde nicht gefunden. Paket neu installieren: npm install -g @stefaneicher/voice-bridge\n',
  );
  process.exit(1);
}

const background = args.includes('--background');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [root, ...args.filter((a) => a !== '--background')], {
  stdio: background ? 'ignore' : 'inherit',
  detached: background,
  windowsHide: false,
  env,
});

if (background) {
  child.unref();
  process.exit(0);
}
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
