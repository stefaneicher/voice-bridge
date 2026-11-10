/**
 * Protocol between the Voice-Bridge Android app and the PC (WebSocket over TLS, ADR-013).
 * Text frames carry JSON messages; binary frames carry 16 kHz mono PCM16LE audio while recording.
 */
import type { HotkeyAction, SessionState } from '../core';

export const REMOTE_PROTOCOL_VERSION = 1;
export const REMOTE_SAMPLE_RATE = 16_000;
export const REMOTE_PATH = '/vb';

export interface RemoteTarget {
  id: string;
  name: string;
  title?: string;
  state: SessionState;
}

export type AppMessage =
  | { t: 'pair'; v: number; code: string; device: string }
  | { t: 'hello'; v: number; deviceId: string; token: string }
  | { t: 'start'; mode: HotkeyAction; target?: string }
  | { t: 'stop' }
  | { t: 'cancel' }
  | { t: 'ping' };

export type PcMessage =
  | { t: 'paired'; deviceId: string; token: string; pc: string; profile: string }
  | { t: 'welcome'; pc: string; profile: string }
  | { t: 'error'; code: 'auth' | 'pairing' | 'busy' | 'protocol' | 'version'; message: string }
  | { t: 'targets'; sessions: RemoteTarget[] }
  | { t: 'status'; phase: 'recording' | 'working' | 'idle'; label?: string }
  | { t: 'result'; ok: true; text: string; target?: string }
  | { t: 'result'; ok: false; kind: string; message: string; text?: string }
  | { t: 'pong' };

const str = (v: unknown, max = 512): v is string => typeof v === 'string' && v.length <= max;

/** Validates an untrusted message from the app. Returns null for anything malformed. */
export function parseAppMessage(raw: string): AppMessage | null {
  if (raw.length > 4096) return null;
  let m: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    m = value as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (m.t) {
    case 'pair':
      return typeof m.v === 'number' && str(m.code, 128) && str(m.device, 128)
        ? { t: 'pair', v: m.v, code: m.code, device: m.device }
        : null;
    case 'hello':
      return typeof m.v === 'number' && str(m.deviceId, 128) && str(m.token, 256)
        ? { t: 'hello', v: m.v, deviceId: m.deviceId, token: m.token }
        : null;
    case 'start':
      if (m.mode !== 'dictate' && m.mode !== 'agent') return null;
      if (m.target !== undefined && !str(m.target, 256)) return null;
      return m.target === undefined
        ? { t: 'start', mode: m.mode }
        : { t: 'start', mode: m.mode, target: m.target as string };
    case 'stop':
    case 'cancel':
    case 'ping':
      return { t: m.t };
    default:
      return null;
  }
}

export interface PairingInfo {
  hosts: string[];
  port: number;
  /** SHA-256 of the PC's TLS certificate, lowercase hex without separators. */
  fingerprint: string;
  code: string;
  pc: string;
}

/** `voicebridge://pair?...` – the content of the QR code shown in the settings. */
export function pairingUri(info: PairingInfo): string {
  const q = new URLSearchParams({
    v: String(REMOTE_PROTOCOL_VERSION),
    h: info.hosts.join(','),
    p: String(info.port),
    fp: info.fingerprint,
    c: info.code,
    n: info.pc,
  });
  return `voicebridge://pair?${q.toString()}`;
}

export function parsePairingUri(uri: string): PairingInfo | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'voicebridge:' || url.hostname !== 'pair') return null;
  const q = url.searchParams;
  const port = Number(q.get('p'));
  const hosts = (q.get('h') ?? '').split(',').filter(Boolean);
  const fingerprint = (q.get('fp') ?? '').toLowerCase();
  const code = q.get('c') ?? '';
  if (!hosts.length || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!/^[0-9a-f]{64}$/.test(fingerprint) || !code) return null;
  return { hosts, port, fingerprint, code, pc: q.get('n') ?? '' };
}
