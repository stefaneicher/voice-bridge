import type { AppConfig } from './config';
import { LIVE_DELAYS } from './live-delay';

export type LabReview = 'unreviewed' | 'correct' | 'incorrect';
export interface LabSettings {
  engine: 'openai';
  model: string;
  language: string;
  dialectHint: string;
  glossary: string[];
  live: AppConfig['stt']['live'];
  polish: AppConfig['stt']['polish'];
  timeoutMs: number;
  deviceId: string;
  sampleRate: 16000;
}

export interface LabAttempt {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  expected: string;
  settings: LabSettings;
  events: { name: string; atMs: number }[];
  previews: { text: string; atMs: number }[];
  releasedAtMs?: number;
  finalAtMs?: number;
  finalText: string;
  rawText?: string;
  durationMs?: number;
  error?: string;
  captureFailed?: boolean;
  review: LabReview;
  correction: string;
}

/** Portable, manually selected package; never contains configuration secrets or endpoint URLs. */
export interface LabPackage {
  schemaVersion: 1;
  attempt: LabAttempt;
  audio: { mimeType: 'audio/wav'; encoding: 'base64'; data: string };
}

export interface LabState {
  enabled: boolean;
  phase: 'idle' | 'starting' | 'recording' | 'capture-error' | 'finishing' | 'result';
  current: LabAttempt | null;
  hasAudio: boolean;
  saved: boolean;
  entries: LabAttempt[];
  storageWarning?: string;
}

export type LabCommand =
  | { type: 'enter' }
  | { type: 'exit' }
  | { type: 'start'; expected: string; cloudConsent: boolean }
  | { type: 'stop' }
  | { type: 'discard' }
  | { type: 'save'; consent: boolean }
  | { type: 'review'; review: LabReview; correction: string }
  | { type: 'load'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'export'; id: string };

export interface LabReply {
  state: LabState;
  message: string;
}

export function labSettings(config: AppConfig): LabSettings {
  const { stt } = config;
  return {
    engine: 'openai',
    model: stt.model,
    language: stt.language,
    dialectHint: stt.dialectHint,
    glossary: [...stt.glossary],
    live: { ...stt.live },
    polish: { ...stt.polish },
    timeoutMs: stt.timeoutMs,
    deviceId: config.audio.deviceId,
    sampleRate: 16000,
  };
}

export const validLabId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);

/** Strict allowlist: malformed or newer packages are ignored, never partially trusted. */
export function parseLabPackage(input: unknown): LabPackage | null {
  try {
    return decodePackage(input);
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 16000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('text');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('number');
  }
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('boolean');
  return value;
}
function array<T>(value: unknown, max: number, parse: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('array');
  return value.map(parse);
}
function decodePackage(input: unknown): LabPackage {
  const p = object(input);
  const a = object(p.attempt);
  const s = object(a.settings);
  const live = object(s.live);
  const polish = object(s.polish);
  const audio = object(p.audio);
  if (
    p.schemaVersion !== 1 ||
    a.schemaVersion !== 1 ||
    !validLabId(a.id) ||
    s.engine !== 'openai' ||
    s.sampleRate !== 16000 ||
    !LIVE_DELAYS.includes(live.delay as LabSettings['live']['delay']) ||
    typeof a.review !== 'string' ||
    !['unreviewed', 'correct', 'incorrect'].includes(a.review) ||
    audio.mimeType !== 'audio/wav' ||
    audio.encoding !== 'base64'
  ) {
    throw new Error('schema');
  }
  const createdAt = text(a.createdAt, 64);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('date');
  const data = text(audio.data, 6_000_000);
  if (!/^UklGR[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new Error('wav');
  }
  const header = atob(data.slice(0, 60));
  const bytes = Uint8Array.from(header, (c) => c.charCodeAt(0));
  if (bytes.length < 44) throw new Error('wav header');
  const view = new DataView(bytes.buffer);
  const audioBytes = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  if (
    header.slice(0, 4) !== 'RIFF' ||
    header.slice(8, 16) !== 'WAVEfmt ' ||
    header.slice(36, 40) !== 'data' ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== 16000 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(4, true) + 8 !== audioBytes ||
    view.getUint32(40, true) + 44 !== audioBytes ||
    (audioBytes - 44) % 2 !== 0
  ) {
    throw new Error('wav format');
  }
  const attempt: LabAttempt = {
    schemaVersion: 1,
    id: a.id,
    createdAt,
    expected: text(a.expected, 2000),
    settings: {
      engine: 'openai',
      model: text(s.model),
      language: text(s.language),
      dialectHint: text(s.dialectHint),
      glossary: array(s.glossary, 1000, (v) => text(v)),
      live: {
        enabled: boolean(live.enabled),
        model: text(live.model),
        delay: live.delay as LabSettings['live']['delay'],
      },
      polish: {
        enabled: boolean(polish.enabled),
        model: text(polish.model),
        instruction: text(polish.instruction),
      },
      timeoutMs: number(s.timeoutMs),
      deviceId: text(s.deviceId),
      sampleRate: 16000,
    },
    events: array(a.events, 2000, (v) => {
      const e = object(v);
      return { name: text(e.name, 100), atMs: number(e.atMs) };
    }),
    previews: array(a.previews, 2000, (v) => {
      const e = object(v);
      return { text: text(e.text), atMs: number(e.atMs) };
    }),
    finalText: text(a.finalText),
    review: a.review as LabReview,
    correction: text(a.correction),
  };
  for (const key of ['releasedAtMs', 'finalAtMs', 'durationMs'] as const) {
    if (a[key] !== undefined) attempt[key] = number(a[key]);
  }
  for (const key of ['rawText', 'error'] as const) {
    if (a[key] !== undefined) attempt[key] = text(a[key]);
  }
  if (a.captureFailed !== undefined) attempt.captureFailed = boolean(a.captureFailed);
  return {
    schemaVersion: 1,
    attempt,
    audio: { mimeType: 'audio/wav', encoding: 'base64', data },
  };
}
