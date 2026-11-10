import { join } from 'node:path';
import { app } from 'electron';
import { VoiceBridgeApp } from './app';
import { parseProfileArg } from './profile';

// A tray app outlives the terminal that started it; writing to its closed console must not crash.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
  });
}

const profile = parseProfileArg(process.argv);
const dataDir = join(app.getPath('appData'), 'voice-bridge', profile);

// Per-profile userData makes the single-instance lock per profile (ADR-006).
app.setPath('userData', dataDir);
app.setAppUserModelId(`ch.voice-bridge.${profile}`);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const vb = new VoiceBridgeApp(profile, dataDir);

  app.on('second-instance', () => vb.openSettings());
  // Tray app: closing the settings window must not quit.
  app.on('window-all-closed', () => {});

  let stopping = false;
  app.on('before-quit', (e) => {
    if (stopping) return;
    stopping = true;
    e.preventDefault();
    void vb.stop().finally(() => app.exit(0));
  });

  void app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide();
    try {
      await vb.start();
    } catch (err) {
      console.error('[voice-bridge] start failed', err);
      app.exit(1);
    }
  });
}
