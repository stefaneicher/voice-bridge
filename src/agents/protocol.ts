/**
 * NDJSON protocol between the `vb run` wrapper and Voice-Bridge (one JSON object per line).
 * See examples/pipe-protocol.example.ndjson.
 */
import type { SessionState } from '../core';

export const PROTOCOL_VERSION = 1;
const MAX_LINE_BYTES = 1024 * 1024;

export interface RegisterMessage {
  type: 'register';
  version: number;
  sessionId: string;
  name: string;
  title?: string;
  cwd?: string;
  command?: string;
  pid?: number;
  /** Set by terminals Voice-Bridge opened itself (`vb run --launch <token>`, T-026). */
  launchToken?: string;
  /** Initial state; launched sessions start as busy until Copilot accepts input. Default idle. */
  state?: SessionState;
}
export interface HeartbeatMessage {
  type: 'heartbeat';
  sessionId: string;
  state: SessionState;
}
export interface ByeMessage {
  type: 'bye';
  sessionId: string;
  exitCode?: number;
}
export interface InjectMessage {
  type: 'inject';
  sessionId: string;
  requestId: string;
  text: string;
  submit: boolean;
  bracketedPaste: boolean;
}
export interface InjectResultMessage {
  type: 'injectResult';
  requestId: string;
  ok: boolean;
  error?: string;
}

export type WrapperMessage = RegisterMessage | HeartbeatMessage | ByeMessage | InjectResultMessage;
export type BridgeMessage = InjectMessage;
export type Message = WrapperMessage | BridgeMessage;

export function encode(message: Message): string {
  return JSON.stringify(message) + '\n';
}

const str = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const isState = (v: unknown) => v === 'idle' || v === 'busy' || v === 'unknown';

/** Validates an untrusted object. Returns null for anything malformed. */
export function parseMessage(value: unknown): Message | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  switch (m.type) {
    case 'register':
      return typeof m.version === 'number' &&
        str(m.sessionId) &&
        str(m.name) &&
        optStr(m.title) &&
        optStr(m.cwd) &&
        optStr(m.command) &&
        (m.pid === undefined || typeof m.pid === 'number') &&
        optStr(m.launchToken) &&
        (m.state === undefined || isState(m.state))
        ? (m as unknown as RegisterMessage)
        : null;
    case 'heartbeat':
      return str(m.sessionId) && isState(m.state) ? (m as unknown as HeartbeatMessage) : null;
    case 'bye':
      return str(m.sessionId) ? (m as unknown as ByeMessage) : null;
    case 'inject':
      return str(m.sessionId) &&
        str(m.requestId) &&
        str(m.text) &&
        typeof m.submit === 'boolean' &&
        typeof m.bracketedPaste === 'boolean'
        ? (m as unknown as InjectMessage)
        : null;
    case 'injectResult':
      return str(m.requestId) && typeof m.ok === 'boolean' && optStr(m.error)
        ? (m as unknown as InjectResultMessage)
        : null;
    default:
      return null;
  }
}

/** Splits a byte stream into messages. Malformed lines are reported, not thrown. */
export function createLineDecoder(
  onMessage: (m: Message) => void,
  onError: (reason: string) => void = () => {},
): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    if (buffer.length > MAX_LINE_BYTES && !buffer.includes('\n')) {
      buffer = '';
      onError('line too long');
      return;
    }
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        onError('invalid JSON');
        continue;
      }
      const message = parseMessage(parsed);
      if (message) onMessage(message);
      else onError('invalid message');
    }
  };
}

/** Text written into the PTY for a prompt: optional bracketed paste, then Enter if submitting. */
export function ptyPayload(text: string, bracketedPaste: boolean): string {
  // Strip control characters a paste must not contain (incl. ESC, so the paste cannot be closed early).
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  return bracketedPaste ? `\x1b[200~${clean}\x1b[201~` : clean.replace(/\n/g, ' ');
}
