import type {
  AudioClip,
  DeliveryResult,
  InputEvent,
  InsertResult,
  SessionInfo,
  Transcript,
} from './types';

export type Unsubscribe = () => void;

/** Global hotkey source. Implementations must return from OS hook callbacks in under 1 ms. */
export interface InputPort {
  onEvent(cb: (event: InputEvent) => void): Unsubscribe;
  /** While true, wheel events are swallowed and reported as `wheel` events. */
  setWheelCapture(enabled: boolean): void;
}

export interface RecorderPort {
  start(): Promise<void>;
  stop(): Promise<AudioClip>;
  cancel(): void;
}

export interface SpeechToText {
  transcribe(clip: AudioClip, options?: { signal?: AbortSignal }): Promise<Transcript>;
}

export interface AgentAdapter {
  readonly id: string;
  listSessions(): Promise<SessionInfo[]>;
  onChange(cb: (sessions: SessionInfo[]) => void): Unsubscribe;
  /** Sends to exactly this session. Must never fall back to another one. */
  send(sessionId: string, text: string): Promise<DeliveryResult>;
  reveal?(sessionId: string): Promise<void>;
}

export interface TextInserter {
  /** Inserts at the current cursor. Never presses Enter. */
  insert(text: string): Promise<InsertResult>;
}

export interface TimerHandle {
  cancel(): void;
}

export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): TimerHandle;
}
