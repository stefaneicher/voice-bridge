import type { Failure, FailureAction, HotkeyAction, SessionInfo, SessionView } from '../core/types';
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
  | { kind: 'working'; mode: HotkeyAction; label: string }
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
  selectSession(id: string): void;
  resolveFailure(id: string, action: FailureAction | { type: 'copy' }): void;
  copyText(text: string): void;
  revealSession(id: string): void;
  setOverlaySize(width: number, height: number, anchor: OverlayAnchor): void;
  ready(): void;

  // settings
  getSettings(): Promise<SettingsData>;
  saveSettings(config: AppConfig): Promise<SettingsData>;
  setApiKey(key: string | null): Promise<SettingsData>;
  setOpenAtLogin(enabled: boolean): Promise<SettingsData>;
  captureHotkey(): Promise<
    | { device: 'mouse'; button: string }
    | { device: 'keyboard'; keycode: number; label?: string }
    | null
  >;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  clearHistory(): Promise<void>;

  // phone (remote microphone)
  getRemote(): Promise<RemoteData>;
  newPairingCode(): Promise<RemoteData>;
  removeDevice(id: string): Promise<RemoteData>;
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
  recorderReady: 'vb:recorder-ready',
} as const;

export type RecorderCommand =
  | { id: number; type: 'start'; deviceId: string }
  | { id: number; type: 'stop' }
  | { id: number; type: 'cancel' }
  | { id: number; type: 'warm'; deviceId: string; enabled: boolean };

export type RecorderReply =
  | { id: number; ok: true; wav?: Uint8Array; durationMs?: number }
  | { id: number; ok: false; error: string };
