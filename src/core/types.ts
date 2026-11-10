/** Which of the two push-to-talk modes a hotkey triggers. */
export type HotkeyAction = 'dictate' | 'agent';

export type MouseButton = 'XButton1' | 'XButton2' | 'Middle';

/** Modifier groups; left and right keys count as the same modifier. */
export type Modifier = 'ctrl' | 'alt' | 'shift' | 'win';

/**
 * A physical key or mouse button bound to a mode, optionally combined with modifiers that must be
 * held (e.g. Strg + Umschalt + D). Keyboard codes are uiohook/Win32 virtual key codes.
 */
export type HotkeyBinding =
  | { device: 'mouse'; button: MouseButton; modifiers?: Modifier[] }
  | { device: 'keyboard'; keycode: number; label?: string; modifiers?: Modifier[] };

export type SessionState = 'idle' | 'busy' | 'unknown';

/** A live agent session as reported by an adapter. Identity is always `id`, never the list index. */
export interface SessionInfo {
  id: string;
  adapterId: string;
  name: string;
  title?: string;
  cwd?: string;
  command?: string;
  pid?: number;
  state: SessionState;
  lastActivity?: string;
}

/** A session as shown in the popup. `gone` marks a selected session that vanished during recording. */
export interface SessionView extends SessionInfo {
  gone: boolean;
}

export type DeliveryResult =
  { ok: true } | { ok: false; reason: 'gone' | 'busy' | 'io'; detail?: string };

export type InsertResult =
  { ok: true } | { ok: false; reason: 'no-textfield' | 'io'; detail?: string };

/** Recorded audio. Lives in memory only. */
export interface AudioClip {
  data: Uint8Array;
  mimeType: string;
  durationMs: number;
}

export interface Transcript {
  /** Final text (after optional polishing). */
  text: string;
  /** Raw transcript before polishing, if polishing ran. */
  raw?: string;
}

/** Normalised input events delivered by an InputPort. */
export type InputEvent =
  /** `targetId` preselects a session (e.g. chosen on the phone before pressing). */
  | { type: 'down'; action: HotkeyAction; targetId?: string }
  | { type: 'up'; action: HotkeyAction }
  | { type: 'wheel'; delta: 1 | -1 };

export type FailureKind =
  'recorder' | 'stt' | 'session-gone' | 'no-sessions' | 'delivery' | 'no-textfield' | 'insert';

/** A failed run. Text and audio stay here until the user acts. */
export interface Failure {
  id: string;
  kind: FailureKind;
  mode: HotkeyAction;
  message: string;
  createdAt: number;
  text?: string;
  rawText?: string;
  audio?: AudioClip;
  target?: SessionInfo;
}

export type FailureAction =
  { type: 'retry' } | { type: 'send-to'; sessionId: string } | { type: 'discard' };
