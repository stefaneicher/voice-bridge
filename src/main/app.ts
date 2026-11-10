import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { Notification, app, clipboard, ipcMain, session } from 'electron';
import { PtyBridgeAdapter } from '../agents/pty-bridge';
import { pipePath } from '../agents/pipe';
import {
  AgentRegistry,
  SessionController,
  bindingLabel,
  windowsKeyLabel,
  type Clock,
  type ControllerState,
  type FailureAction,
  type SpeechToText,
} from '../core';
import { createPlatformInput, type PlatformInput } from '../input';
import { MergedInput } from '../input/merged';
import { SwitchingRecorder } from '../remote/remote-recorder';
import { ClipboardPasteInserter } from '../output/inserter';
import { ElectronClipboard, clipboardOnlyKeys } from '../output/electron-clipboard';
import { Win32Keys } from '../output/win32';
import { OpenAiTranscriber, SttError } from '../stt/openai';
import { normalizeConfig, type AppConfig } from '../shared/config';
import { IPC, type OverlayAnchor, type SettingsData } from '../shared/ipc';
import { History } from './history';
import { RemoteManager } from './remote';
import { ElectronRecorder } from './recorder';
import { SecretStore } from './secrets';
import { readJson, writeJson } from './store';
import { AppTray } from './tray';
import { failureViews, overlayView, trayStatus } from './view';
import { Overlays, createRecorderWindow, createSettingsWindow, type OverlayRole } from './windows';

declare const __APP_VERSION__: string;

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => {
    const t = setTimeout(cb, ms);
    return { cancel: () => clearTimeout(t) };
  },
};

const log = (msg: string) => console.log(`[voice-bridge ${new Date().toISOString()}] ${msg}`);

export class VoiceBridgeApp {
  private config!: AppConfig;
  private readonly configPath: string;
  private readonly secrets: SecretStore;
  private history!: History;
  private overlays!: Overlays;
  private recorderWindow!: BrowserWindow;
  private recorder!: ElectronRecorder;
  private input: PlatformInput | null = null;
  private bridge!: PtyBridgeAdapter;
  private agents!: AgentRegistry;
  private controller!: SessionController;
  private tray!: AppTray;
  private settingsWindow: BrowserWindow | null = null;
  private remote!: RemoteManager;
  private lastPhase: ControllerState['phase']['name'] = 'idle';
  private knownFailures = new Set<string>();

  constructor(
    private readonly profile: string,
    private readonly dataDir: string,
  ) {
    this.configPath = join(dataDir, 'config.json');
    this.secrets = new SecretStore(join(dataDir, 'secrets', 'openai.bin'));
  }

  async start(): Promise<void> {
    this.config = normalizeConfig(readJson(this.configPath), this.profile);
    writeJson(this.configPath, this.config);
    this.history = new History(
      join(this.dataDir, 'history.json'),
      this.config.privacy.historyEntries,
    );

    this.restrictPermissions();

    this.recorderWindow = createRecorderWindow();
    this.overlays = new Overlays();
    this.recorder = new ElectronRecorder(
      () => (this.recorderWindow.isDestroyed() ? null : this.recorderWindow.webContents),
      () => this.config.audio.deviceId,
      (level) => this.overlays.broadcast(IPC.level, level),
    );
    if (this.config.audio.prewarm) {
      // Waits for the recorder window's ready signal.
      this.recorder.warm(true).catch((e: unknown) => log(`prewarm failed: ${String(e)}`));
    }

    this.bridge = new PtyBridgeAdapter({
      pipePath: pipePath(this.profile),
      heartbeatTimeoutMs: this.config.agents.heartbeatTimeoutMs,
      bracketedPaste: this.config.agents.bracketedPaste,
      pressEnter: this.config.agents.pressEnter,
      log,
    });
    try {
      await this.bridge.start();
    } catch (err) {
      this.notify('Agent-Anbindung nicht verfügbar', String(err));
    }
    this.agents = new AgentRegistry([this.bridge]);

    const input = createPlatformInput({
      dictate: this.config.hotkeys.dictate,
      agent: this.config.hotkeys.agent,
    });
    try {
      input.start();
      this.input = input;
    } catch (err) {
      this.notify('Globale Tasten nicht verfügbar', String(err));
    }

    // The phone feeds the same controller: merged input events and a switchable audio source.
    const mergedInput = new MergedInput(input);
    const switchingRecorder = new SwitchingRecorder(this.recorder);
    this.controller = new SessionController({
      input: mergedInput,
      recorder: switchingRecorder,
      stt: this.createStt(),
      inserter: this.createInserter(),
      agents: this.agents,
      clock: realClock,
      minHoldMs: this.config.hotkeys.minHoldMs,
      maxRecordingMs: this.config.hotkeys.maxRecordingSec * 1000,
      lastSessionId: this.config.agents.lastSessionId,
    });

    this.tray = new AppTray({
      togglePause: () => this.controller.setPaused(!this.controller.getState().paused),
      openSettings: () => this.openSettings(),
      openProfile: (p) => this.launchProfile(p),
      copy: (text) => void clipboard.writeText(text),
      quit: () => app.quit(),
    });

    this.remote = new RemoteManager({
      dataDir: this.dataDir,
      profile: this.profile,
      controller: this.controller,
      agents: this.agents,
      recorder: switchingRecorder,
      emit: (e) => mergedInput.emit(e),
      log,
    });
    await this.remote.apply(this.config.remote);

    this.registerIpc();
    this.controller.subscribe((s) => this.onState(s));
    this.onState(this.controller.getState());
    this.agents.onChange(() => this.pushFailures());
    log(`started profile "${this.profile}", pipe ${pipePath(this.profile)}`);
  }

  async stop(): Promise<void> {
    await this.remote?.stop();
    this.input?.stop();
    this.controller?.dispose();
    await this.bridge?.stop();
    this.overlays?.destroy();
    this.tray?.destroy();
  }

  openSettings(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      return;
    }
    this.settingsWindow = createSettingsWindow();
    this.settingsWindow.on('closed', () => (this.settingsWindow = null));
  }

  // ------------------------------------------------------------------ wiring

  private createStt(): SpeechToText {
    const openai = new OpenAiTranscriber({
      config: () => this.config.stt,
      apiKey: async () => this.secrets.get(),
      baseUrl: this.config.stt.baseUrl,
      log,
    });
    return {
      transcribe: (clip, options) => {
        if (!this.config.privacy.cloudAllowed) {
          return Promise.reject(
            new SttError('Cloud-Nutzung ist in diesem Profil ausgeschaltet', 'no-key'),
          );
        }
        return openai.transcribe(clip, options);
      },
    };
  }

  private createInserter() {
    const clipboardPort = new ElectronClipboard();
    if (process.platform === 'win32') {
      const keys = new Win32Keys();
      return new ClipboardPasteInserter({
        clipboard: clipboardPort,
        keys: this.config.insertion.fallbackToTyping ? keys : { sendPaste: () => keys.sendPaste() },
        focus: keys,
        clock: realClock,
        restoreClipboardAfterMs: this.config.insertion.restoreClipboardAfterMs,
      });
    }
    return new ClipboardPasteInserter({
      clipboard: clipboardPort,
      keys: clipboardOnlyKeys,
      clock: realClock,
    });
  }

  private onState(state: ControllerState): void {
    this.overlays.broadcast(IPC.overlay, overlayView(state, this.config));
    this.pushFailures(state);

    if (state.lastSessionId !== this.config.agents.lastSessionId) {
      this.config.agents.lastSessionId = state.lastSessionId;
      writeJson(this.configPath, this.config);
    }

    const phase = state.phase;
    if (phase.name === 'done' && this.lastPhase !== 'done') {
      this.history.add({
        at: new Date().toISOString(),
        mode: phase.mode,
        text: phase.text,
        target: phase.target?.name,
        ok: true,
      });
    }
    this.lastPhase = phase.name;
    for (const f of state.failures) {
      if (this.knownFailures.has(f.id)) continue;
      this.knownFailures.add(f.id);
      if (f.text) {
        this.history.add({
          at: new Date().toISOString(),
          mode: f.mode,
          text: f.text,
          target: f.target?.name,
          ok: false,
        });
      }
    }

    this.tray.update({
      profile: this.profile,
      paused: state.paused,
      status: trayStatus(state),
      model: this.config.stt.model,
      cloud: this.config.privacy.cloudAllowed,
      dictateLabel: bindingLabel(this.config.hotkeys.dictate),
      agentLabel: bindingLabel(this.config.hotkeys.agent),
      history: this.history.list(),
    });
  }

  private pushFailures(state = this.controller.getState()): void {
    void this.agents.listSessions().then((sessions) => {
      this.overlays.broadcast(IPC.failures, failureViews(state), sessions);
    });
  }

  private registerIpc(): void {
    const fromOverlay = (e: Electron.IpcMainEvent): OverlayRole | null =>
      this.overlays.role(e.sender);
    const fromSettings = (e: Electron.IpcMainInvokeEvent) =>
      !!this.settingsWindow && e.sender === this.settingsWindow.webContents;

    ipcMain.on(IPC.overlaySize, (e, w: number, h: number, anchor: OverlayAnchor) => {
      const role = fromOverlay(e);
      if (role && Number.isFinite(w) && Number.isFinite(h)) this.overlays.place(role, w, h, anchor);
    });
    ipcMain.on(IPC.selectSession, (e, id: string) => {
      if (fromOverlay(e) && typeof id === 'string') this.controller.selectSession(id);
    });
    ipcMain.on(IPC.resolveFailure, (e, id: string, action: FailureAction | { type: 'copy' }) => {
      if (!fromOverlay(e) || typeof id !== 'string' || !action) return;
      if (action.type === 'copy') {
        const failure = this.controller.getState().failures.find((f) => f.id === id);
        if (failure?.text) void clipboard.writeText(failure.text);
        void this.controller.resolveFailure(id, { type: 'discard' });
        return;
      }
      void this.controller.resolveFailure(id, action);
    });
    ipcMain.on(IPC.copyText, (e, text: string) => {
      if (fromOverlay(e) && typeof text === 'string') void clipboard.writeText(text);
    });
    ipcMain.on(IPC.revealSession, (e, id: string) => {
      if (fromOverlay(e) && typeof id === 'string') void this.agents.reveal(id);
    });

    ipcMain.handle(IPC.getSettings, (e) => (fromSettings(e) ? this.settingsData() : null));
    ipcMain.handle(IPC.saveSettings, (e, next: unknown) => {
      if (!fromSettings(e)) return null;
      this.applyConfig(normalizeConfig(next, this.profile));
      return this.settingsData();
    });
    ipcMain.handle(IPC.setApiKey, (e, key: unknown) => {
      if (!fromSettings(e)) return null;
      this.secrets.set(typeof key === 'string' && key.trim() ? key.trim() : null);
      return this.settingsData();
    });
    ipcMain.handle(IPC.setOpenAtLogin, (e, enabled: unknown) => {
      if (!fromSettings(e) || !this.loginItemsSupported()) return null;
      app.setLoginItemSettings({ ...this.loginItem(), openAtLogin: enabled === true });
      return this.settingsData();
    });
    ipcMain.handle(IPC.captureHotkey, async (e) => {
      if (!fromSettings(e) || !this.input) return null;
      const input = this.input;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<null>((r) => (timer = setTimeout(() => r(null), 10_000)));
      const captured = await Promise.race([input.captureNext(), timeout]);
      clearTimeout(timer);
      if (!captured) {
        input.cancelCapture(); // otherwise the next key press would still be swallowed
        return null;
      }
      const { raw, modifiers } = captured;
      const mods = modifiers.length ? { modifiers } : {};
      if (raw.device === 'mouse') return { device: 'mouse', button: raw.button, ...mods };
      // Keycodes are Win32 virtual keys on Windows; elsewhere uiohook codes without names.
      return {
        device: 'keyboard',
        keycode: raw.keycode,
        ...(process.platform === 'win32' ? { label: windowsKeyLabel(raw.keycode) } : {}),
        ...mods,
      };
    });
    ipcMain.handle(IPC.testConnection, async (e) => {
      if (!fromSettings(e)) return null;
      return this.testConnection();
    });
    ipcMain.handle(IPC.getRemote, (e) => (fromSettings(e) ? this.remote.data() : null));
    ipcMain.handle(IPC.newPairingCode, (e) => {
      if (!fromSettings(e)) return null;
      this.remote.newCode();
      return this.remote.data();
    });
    ipcMain.handle(IPC.removeDevice, (e, id: unknown) => {
      if (!fromSettings(e) || typeof id !== 'string') return null;
      this.remote.removeDevice(id);
      return this.remote.data();
    });
    ipcMain.handle(IPC.clearHistory, (e) => {
      if (fromSettings(e)) this.history.clear();
    });
  }

  private applyConfig(next: AppConfig): void {
    const prewarmChanged = next.audio.prewarm !== this.config.audio.prewarm;
    next.agents.lastSessionId = this.config.agents.lastSessionId;
    this.config = next;
    writeJson(this.configPath, next);
    this.input?.setBindings({ dictate: next.hotkeys.dictate, agent: next.hotkeys.agent });
    this.controller.configure({
      minHoldMs: next.hotkeys.minHoldMs,
      maxRecordingMs: next.hotkeys.maxRecordingSec * 1000,
    });
    this.history.setLimit(next.privacy.historyEntries);
    void this.remote.apply(next.remote);
    if (prewarmChanged) void this.recorder.warm(next.audio.prewarm).catch(() => {});
    this.onState(this.controller.getState());
  }

  private settingsData(): SettingsData {
    return {
      config: this.config,
      hasApiKey: this.secrets.has(),
      secureStorage: this.secrets.available(),
      version: __APP_VERSION__,
      platform: process.platform,
      pipePath: pipePath(this.profile),
      openAtLogin: this.loginItemsSupported()
        ? app.getLoginItemSettings(this.loginItem()).openAtLogin
        : null,
    };
  }

  private loginItemsSupported(): boolean {
    return process.platform === 'win32' || process.platform === 'darwin';
  }

  /** Login item per profile. When started via npm, Electron needs the app path as first argument. */
  private loginItem(): { path: string; args: string[] } {
    const args = ['--profile', this.profile];
    return {
      path: process.execPath,
      args: process.defaultApp ? [app.getAppPath(), ...args] : args,
    };
  }

  private async testConnection(): Promise<{ ok: boolean; message: string }> {
    const key = this.secrets.get();
    if (!key) return { ok: false, message: 'Kein API-Key hinterlegt' };
    try {
      const res = await fetch(`${this.config.stt.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true, message: 'Verbindung zu OpenAI funktioniert' };
      return { ok: false, message: `OpenAI antwortet mit HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: `Keine Verbindung: ${String(err)}` };
    }
  }

  /** Only the hidden recorder window may use the microphone; everything else is denied. */
  private restrictPermissions(): void {
    const isRecorder = (wc: Electron.WebContents | null) =>
      !!wc && !!this.recorderWindow && wc === this.recorderWindow.webContents;
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
      cb(permission === 'media' && isRecorder(wc));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission) => {
      return permission === 'media' && isRecorder(wc);
    });
  }

  private launchProfile(profile: string): void {
    const args = process.argv.slice(1).filter((a, i, all) => {
      if (a === '--profile' || a.startsWith('--profile=')) return false;
      return all[i - 1] !== '--profile';
    });
    spawn(process.execPath, [...args, '--profile', profile], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }

  private notify(title: string, body: string): void {
    log(`${title}: ${body}`);
    if (Notification.isSupported()) new Notification({ title, body }).show();
  }
}
