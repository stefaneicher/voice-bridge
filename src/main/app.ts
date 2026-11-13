import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import { Notification, app, clipboard, dialog, ipcMain, session } from 'electron';
import { copilotTitleLookup } from '../agents/copilot-sessions';
import { PtyBridgeAdapter } from '../agents/pty-bridge';
import { pipePath } from '../agents/pipe';
import { TerminalLauncher } from '../agents/terminal-launcher';
import {
  AgentRegistry,
  PromptHistory,
  RoutedInserter,
  SessionController,
  bindingLabel,
  deskSessions,
  newSessionFolder,
  windowsKeyLabel,
  type Clock,
  type ControllerState,
  type FailureAction,
  type SessionInfo,
  type SpeechToText,
} from '../core';
import { createPlatformInput, type PlatformInput } from '../input';
import { MergedInput } from '../input/merged';
import { SwitchingRecorder } from '../remote/remote-recorder';
import { ClipboardPasteInserter } from '../output/inserter';
import { ElectronClipboard, clipboardOnlyKeys } from '../output/electron-clipboard';
import { Win32Keys } from '../output/win32';
import { OpenAiTranscriber, SttError } from '../stt/openai';
import { LiveTranscription } from '../stt/live';
import { RealtimeTranscription } from '../stt/realtime';
import { normalizeConfig, type AppConfig } from '../shared/config';
import { labSettings, type LabCommand, type LabReply } from '../shared/speech-lab';
import {
  IPC,
  type DeskActionResult,
  type DeskData,
  type DeskLayout,
  type InspectorTab,
  type OverlayAnchor,
  type SettingsData,
} from '../shared/ipc';
import { History } from './history';
import { RemoteManager } from './remote';
import { ElectronRecorder } from './recorder';
import { SecretStore } from './secrets';
import { readJson, writeJson } from './store';
import { AppTray } from './tray';
import { SpeechLab, type LabPipeline } from './speech-lab';
import { SpeechLabStore } from './speech-lab-store';
import { failureViews, overlayView, trayStatus } from './view';
import { Overlays, createDeskWindow, createRecorderWindow, type OverlayRole } from './windows';

declare const __APP_VERSION__: string;

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => {
    const t = setTimeout(cb, ms);
    return { cancel: () => clearTimeout(t) };
  },
};

const log = (msg: string) => console.log(`[voice-bridge ${new Date().toISOString()}] ${msg}`);

/** How long to wait for the final live transcript after release before using the file fallback. */
const LIVE_FINISH_TIMEOUT_MS = 5000;

export class VoiceBridgeApp {
  private config!: AppConfig;
  private readonly configPath: string;
  private readonly secrets: SecretStore;
  private history!: History;
  private overlays!: Overlays;
  private recorderWindow!: BrowserWindow;
  private recorder!: ElectronRecorder;
  private live!: LiveTranscription;
  private lab!: SpeechLab;
  private labStore!: SpeechLabStore;
  private labLive: LiveTranscription | null = null;
  private pausedBeforeLab = false;
  private input: PlatformInput | null = null;
  private bridge!: PtyBridgeAdapter;
  private agents!: AgentRegistry;
  private controller!: SessionController;
  private tray!: AppTray;
  private deskWindow: BrowserWindow | null = null;
  private remote!: RemoteManager;
  private lastPhase: ControllerState['phase']['name'] = 'idle';
  private knownFailures = new Set<string>();
  /** Last seen data of the pinned session, so the desk can show it as «getrennt» once it is gone. */
  private pinnedInfo: SessionInfo | undefined;
  /** Composer prompts of this run (ADR-018); never written to disk. */
  private readonly prompts = new PromptHistory();
  /** The desk reports whether its composer is the active input. */
  private composerActive = false;

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
    this.live = new LiveTranscription({
      open: (onText) => this.openLiveSession(onText),
      onText: (text) => this.overlays.broadcast(IPC.liveText, text),
      finishTimeoutMs: () => LIVE_FINISH_TIMEOUT_MS,
      log,
    });
    this.labStore = new SpeechLabStore(join(this.dataDir, 'speech-lab'));
    this.lab = new SpeechLab(this.labStore, () => {
      const win = this.deskWindow;
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.speechLabState, this.lab.state());
      }
    });
    this.recorder = new ElectronRecorder(
      () => (this.recorderWindow.isDestroyed() ? null : this.recorderWindow.webContents),
      () => this.config.audio.deviceId,
      (level) => this.overlays.broadcast(IPC.level, level),
      undefined,
      {
        stream: () => (this.lab.active ? !!this.labLive?.active : this.live.active),
        onPcm: (pcm) => {
          if (this.lab.active) this.labLive?.push(pcm);
          else this.live.push(pcm);
        },
      },
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
      titleLookup: copilotTitleLookup(),
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
    // Only the local microphone streams live (ADR-016).
    const mergedInput = new MergedInput(input);
    const switchingRecorder = new SwitchingRecorder(this.live.recorder(this.recorder));
    this.controller = new SessionController({
      input: mergedInput,
      recorder: switchingRecorder,
      stt: this.createStt(),
      inserter: new RoutedInserter(
        this.createInserter(),
        () => this.composerReceives(),
        (text) => this.toComposer(text),
      ),
      agents: this.agents,
      clock: realClock,
      minHoldMs: this.config.hotkeys.minHoldMs,
      maxRecordingMs: this.config.hotkeys.maxRecordingSec * 1000,
      lastSessionId: this.config.agents.lastSessionId,
      launcher: new TerminalLauncher({ profile: this.profile, appPath: app.getAppPath() }),
      createToken: () => randomBytes(4).toString('hex'),
    });

    this.tray = new AppTray({
      togglePause: () => {
        if (!this.lab.active) this.controller.setPaused(!this.controller.getState().paused);
      },
      openDesk: () => this.openDesk(),
      openSettings: () => this.openDesk('settings'),
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
    if (!this.config.desk.startInTray) this.openDesk();
    log(`started profile "${this.profile}", pipe ${pipePath(this.profile)}`);
  }

  async stop(): Promise<void> {
    if (this.lab?.busy) await this.lab.stop();
    await this.remote?.stop();
    this.input?.stop();
    this.controller?.dispose();
    await this.bridge?.stop();
    this.overlays?.destroy();
    this.tray?.destroy();
  }

  async confirmQuit(): Promise<boolean> {
    if (!this.lab?.hasUnsavedTest) return true;
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: 'Ungespeicherten Test verwerfen?',
      message: 'Der aktuelle Test ist nicht lokal gespeichert.',
      detail:
        'Beim Beenden werden Aufnahme, Preview-Verlauf und Transkript verworfen. Bereits an die STT-Cloud übertragene Audiodaten lassen sich nicht zurückholen.',
      buttons: ['Weiter testen', 'Test verwerfen und beenden'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const win = this.deskWindow;
    const result = await (win && !win.isDestroyed()
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options));
    if (result.response !== 1) return false;
    this.lab.discardForQuit();
    this.labLive = null;
    return true;
  }

  /** Shows the main window «Agent Desk» (ADR-018); `tab` selects the inspector tab. */
  openDesk(tab: InspectorTab | null = null): void {
    const existing = this.deskWindow;
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      existing.webContents.send(IPC.deskOpen, tab);
      return;
    }
    const win = createDeskWindow();
    this.deskWindow = win;
    win.webContents.once('did-finish-load', () => win.webContents.send(IPC.deskOpen, tab));
    // A close must not silently discard a RAM-only test or leave the microphone running.
    win.on('close', (e) => {
      if (this.lab.active) e.preventDefault();
    });
    win.on('closed', () => {
      if (this.deskWindow === win) {
        this.deskWindow = null;
        this.composerActive = false;
      }
    });
  }

  // ------------------------------------------------------------------ wiring

  private createStt(): SpeechToText {
    const openai = new OpenAiTranscriber({
      config: () => this.config.stt,
      apiKey: async () => this.secrets.get(),
      baseUrl: this.config.stt.baseUrl,
      log,
    });
    const stt = this.live.stt(openai, (raw, signal) => openai.refine(raw, signal));
    return {
      transcribe: (clip, options) => {
        if (!this.config.privacy.cloudAllowed) {
          return Promise.reject(
            new SttError('Cloud-Nutzung ist in diesem Profil ausgeschaltet', 'no-key'),
          );
        }
        return stt.transcribe(clip, options);
      },
    };
  }

  private openLiveSession(
    onText: (text: string) => void,
    config = this.config,
    diagnostic = false,
  ): RealtimeTranscription | null {
    const { stt, privacy } = config;
    if (!stt.live.enabled || !privacy.cloudAllowed) return null;
    const apiKey = this.secrets.get();
    if (!apiKey) return null;
    return new RealtimeTranscription({
      baseUrl: stt.baseUrl,
      apiKey,
      config: {
        model: stt.live.model,
        language: stt.language,
        // No prompt sentence for live: the realtime model copies it into the text ("context: …").
        prompt: '',
        keywords: stt.glossary,
        delay: stt.live.delay,
      },
      onText,
      log: diagnostic ? undefined : log,
    });
  }

  private labPipeline(preview: (text: string) => void, event: (name: string) => void): LabPipeline {
    const config = structuredClone(this.config);
    const file = new OpenAiTranscriber({
      config: () => config.stt,
      apiKey: async () => this.secrets.get(),
      baseUrl: config.stt.baseUrl,
    });
    const live = new LiveTranscription({
      open: (onText) => this.openLiveSession(onText, config, true),
      onText: preview,
      finishTimeoutMs: () => LIVE_FINISH_TIMEOUT_MS,
    });
    this.labLive = live;
    return {
      recorder: live.recorder(this.recorder),
      stt: live.stt(
        {
          transcribe: (clip, options) => {
            event('file-transcription');
            return file.transcribe(clip, options);
          },
        },
        (raw, signal) => file.refine(raw, signal),
      ),
    };
  }

  private async labCommand(command: LabCommand): Promise<LabReply> {
    try {
      switch (command.type) {
        case 'enter': {
          if (this.lab.active) break;
          const state = this.controller.getState();
          if (!['idle', 'done'].includes(state.phase.name)) {
            throw new Error('Zuerst das laufende Diktat oder die Agent-Aktion abschliessen.');
          }
          this.pausedBeforeLab = state.paused;
          this.controller.setPaused(true);
          this.composerActive = false;
          this.lab.enter();
          break;
        }
        case 'exit':
          if (!this.lab.active) break;
          this.lab.exit();
          this.labLive = null;
          this.controller.setPaused(this.pausedBeforeLab);
          break;
        case 'start':
          if (!this.config.privacy.cloudAllowed || !this.secrets.has()) {
            throw new Error('Cloud-Nutzung und API-Key müssen in den Einstellungen bereit sein.');
          }
          await this.lab.start(
            command.expected,
            command.cloudConsent,
            labSettings(this.config),
            (preview, event) => this.labPipeline(preview, event),
          );
          break;
        case 'stop':
          await this.lab.stop();
          break;
        case 'discard':
          this.lab.discard();
          this.labLive = null;
          break;
        case 'save':
          this.lab.save(command.consent);
          break;
        case 'review':
          this.lab.review(command.review, command.correction);
          break;
        case 'load':
          this.lab.load(command.id);
          break;
        case 'delete':
          this.lab.delete(command.id);
          break;
        case 'export': {
          if (this.lab.busy) throw new Error('Aufnahme zuerst stoppen.');
          const p = this.labStore.read(command.id);
          if (!p) throw new Error('Bitte den ausgewählten Test zuerst lokal speichern.');
          const picked = await dialog.showSaveDialog(this.deskWindow!, {
            title: 'Ausgewählten Test mit Audio exportieren (keine Übertragung)',
            defaultPath: `voice-bridge-test-${p.attempt.id}.json`,
            filters: [{ name: 'Testpaket mit WAV (Base64)', extensions: ['json'] }],
          });
          if (!picked.canceled && picked.filePath) {
            writeFileSync(picked.filePath, JSON.stringify(p, null, 2), {
              encoding: 'utf8',
              mode: 0o600,
            });
          }
          break;
        }
      }
      return { state: this.lab.state(), message: '' };
    } catch (error) {
      const message =
        error instanceof Error && !('code' in error)
          ? error.message
          : 'Dateiaktion fehlgeschlagen. Der aktuelle Test bleibt im Arbeitsspeicher.';
      return { state: this.lab.state(), message };
    }
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
      const desk = this.deskWindow;
      if (desk && !desk.isDestroyed()) desk.webContents.send(IPC.desk, this.deskData(sessions));
    });
  }

  private deskData(sessions: SessionInfo[]): DeskData {
    const pinnedId = this.controller.getState().lastSessionId;
    const pinned = sessions.find((s) => s.id === pinnedId);
    if (pinned) this.pinnedInfo = pinned;
    return {
      sessions: deskSessions(sessions, pinnedId, this.pinnedInfo),
      pinnedId,
      canLaunch: this.controller.canLaunch(),
      newFolder: newSessionFolder(sessions, pinnedId),
      history: [...this.prompts.entries],
    };
  }

  /** Dictation goes into the composer only while our own desk window has focus (ADR-018). */
  private composerReceives(): boolean {
    const win = this.deskWindow;
    return this.composerActive && !!win && !win.isDestroyed() && win.isFocused();
  }

  private toComposer(text: string): boolean {
    const win = this.deskWindow;
    if (!win || win.isDestroyed()) return false;
    win.webContents.send(IPC.composerText, text);
    return true;
  }

  /** Composer «Senden»: strictly to the pinned session; the renderer keeps the text on failure. */
  private async sendPrompt(text: string): Promise<DeskActionResult> {
    const pinned = this.controller.getState().lastSessionId ?? undefined;
    const result = await this.controller.sendText(pinned, text);
    if (!result.ok) return result;
    this.prompts.add(text);
    this.pushFailures();
    return { ok: true, message: '' };
  }

  /** «＋ Neue Session» from the desk; without a folder the user picks one first. */
  private async launchFromDesk(folder: string | null): Promise<DeskActionResult> {
    let target = folder;
    if (!target) {
      const win = this.deskWindow;
      const options: Electron.OpenDialogOptions = {
        title: 'Ordner für die neue Session',
        properties: ['openDirectory'],
      };
      const picked = await (win && !win.isDestroyed()
        ? dialog.showOpenDialog(win, options)
        : dialog.showOpenDialog(options));
      target = picked.canceled ? null : (picked.filePaths[0] ?? null);
      if (!target) return { ok: false, message: '' };
    }
    const result = await this.controller.launchSession(target);
    return result.ok ? { ok: true, message: '' } : result;
  }

  private registerIpc(): void {
    const fromOverlay = (e: Electron.IpcMainEvent): OverlayRole | null =>
      this.overlays.role(e.sender);
    // The settings live in the desk window (ADR-018).
    const fromSettings = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) =>
      !!this.deskWindow &&
      !this.deskWindow.isDestroyed() &&
      e.sender === this.deskWindow.webContents;

    ipcMain.on(
      IPC.overlaySize,
      (e, w: number, h: number, anchor: OverlayAnchor, above: unknown) => {
        const role = fromOverlay(e);
        if (!role || !Number.isFinite(w) || !Number.isFinite(h)) return;
        const offset = typeof above === 'number' && Number.isFinite(above) ? above : 0;
        this.overlays.place(role, w, h, anchor, offset);
      },
    );
    ipcMain.on(IPC.selectSession, (e, id: string) => {
      if (fromOverlay(e) && typeof id === 'string') this.controller.selectSession(id);
    });
    ipcMain.on(IPC.resolveFailure, (e, id: string, action: FailureAction | { type: 'copy' }) => {
      if (!fromOverlay(e) || typeof id !== 'string' || !action) return;
      if (this.lab.active && action.type !== 'discard' && action.type !== 'copy') return;
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
      if ((fromOverlay(e) || fromSettings(e)) && typeof id === 'string') {
        void this.agents.reveal(id);
      }
    });

    ipcMain.handle(IPC.getSettings, (e) => (fromSettings(e) ? this.settingsData() : null));
    ipcMain.handle(IPC.saveSettings, (e, next: unknown) => {
      if (!fromSettings(e)) return null;
      if (this.lab.active) return this.settingsData();
      this.applyConfig(normalizeConfig(next, this.profile));
      return this.settingsData();
    });
    ipcMain.handle(IPC.setApiKey, (e, key: unknown) => {
      if (!fromSettings(e)) return null;
      if (this.lab.active) return this.settingsData();
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
    ipcMain.on(IPC.deskLayout, (e, layout: Partial<DeskLayout> | null) => {
      if (!fromSettings(e) || !layout) return;
      const desk = this.config.desk;
      if (typeof layout.leftCollapsed === 'boolean') desk.leftCollapsed = layout.leftCollapsed;
      if (typeof layout.rightCollapsed === 'boolean') desk.rightCollapsed = layout.rightCollapsed;
      writeJson(this.configPath, this.config);
    });
    ipcMain.handle(IPC.getDesk, async (e) =>
      fromSettings(e) ? this.deskData(await this.agents.listSessions()) : null,
    );
    ipcMain.on(IPC.pinSession, (e, id: unknown) => {
      if (fromSettings(e) && typeof id === 'string') this.controller.pinSession(id);
    });
    ipcMain.handle(IPC.launchSession, (e, folder: unknown) => {
      if (!fromSettings(e)) return null;
      if (this.lab.active) return { ok: false, message: 'Testlabor zuerst verlassen.' };
      return this.launchFromDesk(typeof folder === 'string' && folder ? folder : null);
    });
    ipcMain.handle(IPC.sendPrompt, (e, text: unknown) => {
      if (!fromSettings(e) || typeof text !== 'string') return null;
      if (this.lab.active) return { ok: false, message: 'Testlabor zuerst verlassen.' };
      return this.sendPrompt(text);
    });
    ipcMain.on(IPC.composerActive, (e, active: unknown) => {
      if (fromSettings(e)) this.composerActive = !this.lab.active && active === true;
    });
    ipcMain.handle(IPC.getSpeechLab, (e) => (fromSettings(e) ? this.lab.state() : null));
    ipcMain.handle(IPC.speechLabCommand, (e, command: LabCommand | null) => {
      if (!fromSettings(e) || !command || typeof command.type !== 'string') return null;
      return this.labCommand(command);
    });
  }

  private applyConfig(next: AppConfig): void {
    const prewarmChanged = next.audio.prewarm !== this.config.audio.prewarm;
    next.agents.lastSessionId = this.config.agents.lastSessionId;
    // The desk writes its layout directly; a settings save must not reset it.
    next.desk.leftCollapsed = this.config.desk.leftCollapsed;
    next.desk.rightCollapsed = this.config.desk.rightCollapsed;
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
