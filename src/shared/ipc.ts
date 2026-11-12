import type {
  Failure,
  FailureAction,
  HotkeyAction,
  HotkeyBinding,
  SessionInfo,
  SessionView,
} from '../core/types';
import type { DeskSession } from '../core/desk';
import type { AppConfig } from './config';

export type OverlayAnchor = 'bottom-center' | 'bottom-right' | 'cursor';

/** What the overlays need to render. Derived from the controller state in the main process. */
export type OverlayView =
  | { kind: 'hidden' }
  | {
      kind: 'recording';
      mode: HotkeyAction;
      startedAt: number;
      hotkeyLabel: string;
      profile: string;
      sessions?: SessionView[];
      selectedId?: string | null;
      loading?: boolean;
    }
  | { kind: 'working'; mode: HotkeyAction; label: string; cancellable?: boolean }
  | {
      kind: 'done';
      mode: HotkeyAction;
      text: string;
      rawText?: string;
      showRaw: boolean;
      target?: SessionInfo;
      words: number;
      elapsedMs: number;
    };

/** Failure as sent to the renderer: audio stays in the main process, only its length travels. */
export type FailureView = Omit<Failure, 'audio'> & { audioMs?: number };

export interface TrayView {
  profile: string;
  paused: boolean;
  status: 'ready' | 'recording-dictate' | 'recording-agent' | 'working' | 'error' | 'paused';
  model: string;
  cloud: boolean;
  dictateLabel: string;
  agentLabel: string;
  history: HistoryEntry[];
}

export interface HistoryEntry {
  at: string;
  mode: HotkeyAction;
  text: string;
  target?: string;
  ok: boolean;
}

export interface SettingsData {
  config: AppConfig;
  hasApiKey: boolean;
  secureStorage: boolean;
  version: string;
  platform: string;
  pipePath: string;
  /** null where the OS has no login items (Linux). */
  openAtLogin: boolean | null;
}

/** API exposed by the preload script as `window.vb`. */
export interface VoiceBridgeApi {
  onOverlay(cb: (view: OverlayView) => void): () => void;
  onFailures(cb: (failures: FailureView[], sessions: SessionInfo[]) => void): () => void;
  onLevel(cb: (level: number) => void): () => void;
  /** Text recognised so far while recording (live transcription); '' when a recording starts. */
  onLiveText(cb: (text: string) => void): () => void;
  selectSession(id: string): void;
  resolveFailure(id: string, action: FailureAction | { type: 'copy' }): void;
  copyText(text: string): void;
  revealSession(id: string): void;
  /** `above`: px of content above the anchored part (e.g. live text over the popup). */
  setOverlaySize(width: number, height: number, anchor: OverlayAnchor, above?: number): void;
  ready(): void;

  // settings
  getSettings(): Promise<SettingsData>;
  saveSettings(config: AppConfig): Promise<SettingsData>;
  setApiKey(key: string | null): Promise<SettingsData>;
  setOpenAtLogin(enabled: boolean): Promise<SettingsData>;
  captureHotkey(): Promise<HotkeyBinding | null>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  clearHistory(): Promise<void>;

  // phone (remote microphone)
  getRemote(): Promise<RemoteData>;
  newPairingCode(): Promise<RemoteData>;
  removeDevice(id: string): Promise<RemoteData>;

  // main window «Agent Desk» (ADR-018)
  /** Main asks the desk to show an inspector tab (tray «Einstellungen …», second start). */
  onDeskOpen(cb: (tab: InspectorTab | null) => void): () => void;
  setDeskLayout(layout: DeskLayout): void;
  getDesk(): Promise<DeskData | null>;
  onDesk(cb: (data: DeskData) => void): () => void;
  /** Fixes the agent target by ID; never redirects to another session. */
  pinSession(id: string): void;
  /** «＋ Neue Session» via the T-026 launcher; null asks for a folder first. */
  launchSession(folder: string | null): Promise<DeskActionResult | null>;
  /** Composer: sends to the pinned session only; on failure the text stays in the composer. */
  sendPrompt(text: string): Promise<DeskActionResult | null>;
  /** Whether the composer is the active input of the desk (dictation goes there, ADR-018). */
  setComposerActive(active: boolean): void;
  /** Dictated text for the composer while the desk has focus. */
  onComposerText(cb: (text: string) => void): () => void;
}

export type InspectorTab = 'session' | 'settings';
export type DeskLayout = Pick<AppConfig['desk'], 'leftCollapsed' | 'rightCollapsed'>;

export interface DeskData {
  sessions: DeskSession[];
  pinnedId: string | null;
  canLaunch: boolean;
  /** Folder «＋ Neue Session» opens in by default. */
  newFolder?: string;
  /** Prompts sent from the composer during this run, newest first (memory only). */
  history: string[];
}

/** ok: false with an empty message: the user cancelled (e.g. the folder dialog). */
export interface DeskActionResult {
  ok: boolean;
  message: string;
}

export interface RemoteData {
  enabled: boolean;
  running: boolean;
  error?: string;
  port: number;
  /** QR code content; only while a pairing code is valid. */
  pairingUri?: string;
  hosts: string[];
  devices: { id: string; name: string; pairedAt: string; lastSeen?: string }[];
}

export const IPC = {
  overlay: 'vb:overlay',
  failures: 'vb:failures',
  level: 'vb:level',
  selectSession: 'vb:select-session',
  resolveFailure: 'vb:resolve-failure',
  copyText: 'vb:copy-text',
  revealSession: 'vb:reveal-session',
  overlaySize: 'vb:overlay-size',
  ready: 'vb:ready',
  getSettings: 'vb:get-settings',
  saveSettings: 'vb:save-settings',
  setApiKey: 'vb:set-api-key',
  setOpenAtLogin: 'vb:set-open-at-login',
  captureHotkey: 'vb:capture-hotkey',
  testConnection: 'vb:test-connection',
  clearHistory: 'vb:clear-history',
  getRemote: 'vb:get-remote',
  newPairingCode: 'vb:new-pairing-code',
  removeDevice: 'vb:remove-device',
  recorderCommand: 'vb:recorder-command',
  recorderReply: 'vb:recorder-reply',
  recorderLevel: 'vb:recorder-level',
  recorderPcm: 'vb:recorder-pcm',
  liveText: 'vb:live-text',
  recorderReady: 'vb:recorder-ready',
  deskOpen: 'vb:desk-open',
  deskLayout: 'vb:desk-layout',
  getDesk: 'vb:get-desk',
  desk: 'vb:desk',
  pinSession: 'vb:pin-session',
  launchSession: 'vb:launch-session',
  sendPrompt: 'vb:send-prompt',
  composerActive: 'vb:composer-active',
  composerText: 'vb:composer-text',
} as const;

export type RecorderCommand =
  | { id: number; type: 'start'; deviceId: string; stream?: boolean }
  | { id: number; type: 'stop' }
  | { id: number; type: 'cancel' }
  | { id: number; type: 'warm'; deviceId: string; enabled: boolean };

export type RecorderReply =
  | { id: number; ok: true; wav?: Uint8Array; durationMs?: number }
  | { id: number; ok: false; error: string };
