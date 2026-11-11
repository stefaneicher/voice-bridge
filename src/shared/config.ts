import { normalizeModifiers } from '../core/bindings';
import type { HotkeyBinding, MouseButton } from '../core/types';
import { LIVE_DELAYS, type LiveDelay } from './live-delay';

/** Per-profile configuration (see examples/config.example.json). API keys are never stored here. */
export interface AppConfig {
  profile: string;
  hotkeys: {
    dictate: HotkeyBinding;
    agent: HotkeyBinding;
    minHoldMs: number;
    maxRecordingSec: number;
  };
  audio: {
    deviceId: string;
    sampleRate: number;
    /** Keep the microphone open between recordings for a fast start. */
    prewarm: boolean;
  };
  stt: {
    engine: 'openai';
    model: string;
    language: string;
    dialectHint: string;
    glossary: string[];
    baseUrl: string;
    polish: { enabled: boolean; model: string; instruction: string };
    /** Realtime transcription while speaking (ADR-016); falls back to `model` on failure. */
    live: { enabled: boolean; model: string; delay: LiveDelay };
    showRawTranscript: boolean;
    timeoutMs: number;
  };
  insertion: {
    restoreClipboardAfterMs: number;
    fallbackToTyping: boolean;
  };
  agents: {
    bracketedPaste: boolean;
    pressEnter: boolean;
    heartbeatTimeoutMs: number;
    lastSessionId: string | null;
  };
  privacy: {
    cloudAllowed: boolean;
    historyEntries: number;
  };
  /** Phone as microphone (Android app, ADR-013). Off by default. */
  remote: {
    enabled: boolean;
    port: number;
  };
}

export const STT_MODELS = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'] as const;

export function defaultConfig(profile: string): AppConfig {
  return {
    profile,
    hotkeys: {
      dictate: { device: 'mouse', button: 'XButton1' },
      agent: { device: 'mouse', button: 'XButton2' },
      minHoldMs: 300,
      maxRecordingSec: 120,
    },
    audio: { deviceId: 'default', sampleRate: 16000, prewarm: true },
    stt: {
      engine: 'openai',
      model: 'gpt-4o-transcribe',
      language: 'de',
      dialectHint: 'Schweizerdeutsch (Berndeutsch)',
      glossary: ['Copilot', 'Citrix', 'Pull Request', 'Deployment'],
      baseUrl: 'https://api.openai.com/v1',
      polish: {
        enabled: false,
        model: 'gpt-4o-mini',
        instruction:
          'Schreibe in gut lesbarem Schweizer Hochdeutsch (ss statt ß). Inhalt nicht verändern, Füllwörter entfernen.',
      },
      live: { enabled: true, model: 'gpt-live-transcribe', delay: 'low' },
      showRawTranscript: false,
      timeoutMs: 15000,
    },
    insertion: { restoreClipboardAfterMs: 300, fallbackToTyping: true },
    agents: {
      bracketedPaste: true,
      pressEnter: true,
      heartbeatTimeoutMs: 5000,
      lastSessionId: null,
    },
    privacy: { cloudAllowed: true, historyEntries: 50 },
    remote: { enabled: false, port: 47613 },
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const MOUSE_BUTTONS: readonly MouseButton[] = ['XButton1', 'XButton2', 'Middle'];

function binding(v: unknown, fallback: HotkeyBinding): HotkeyBinding {
  if (!isObj(v)) return fallback;
  const modifiers = Array.isArray(v.modifiers) ? normalizeModifiers(v.modifiers) : [];
  const mods = modifiers.length ? { modifiers } : {};
  if (v.device === 'mouse' && MOUSE_BUTTONS.includes(v.button as MouseButton)) {
    return { device: 'mouse', button: v.button as MouseButton, ...mods };
  }
  if (v.device === 'keyboard' && Number.isInteger(v.keycode)) {
    return {
      device: 'keyboard',
      keycode: v.keycode as number,
      ...(typeof v.label === 'string' ? { label: v.label } : {}),
      ...mods,
    };
  }
  return fallback;
}

/**
 * Deep-merges untrusted JSON onto the defaults: values of the wrong type fall back to the default,
 * unknown keys are dropped. Never throws.
 */
export function normalizeConfig(input: unknown, profile: string): AppConfig {
  const d = defaultConfig(profile);
  const merged = mergeTyped(d, input) as AppConfig;
  const raw = isObj(input) ? input : {};
  const hk = isObj(raw.hotkeys) ? raw.hotkeys : {};
  merged.hotkeys.dictate = binding(hk.dictate, d.hotkeys.dictate);
  merged.hotkeys.agent = binding(hk.agent, d.hotkeys.agent);
  const agents = isObj(raw.agents) ? raw.agents : {};
  merged.agents.lastSessionId =
    typeof agents.lastSessionId === 'string' ? agents.lastSessionId : null;
  merged.profile = profile;
  merged.hotkeys.minHoldMs = clamp(merged.hotkeys.minHoldMs, 0, 5000);
  merged.hotkeys.maxRecordingSec = clamp(merged.hotkeys.maxRecordingSec, 5, 600);
  merged.stt.timeoutMs = clamp(merged.stt.timeoutMs, 1000, 120_000);
  if (!LIVE_DELAYS.includes(merged.stt.live.delay)) merged.stt.live.delay = d.stt.live.delay;
  merged.privacy.historyEntries = clamp(merged.privacy.historyEntries, 0, 1000);
  merged.remote.port = clamp(merged.remote.port, 1024, 65535);
  return merged;
}

function mergeTyped(def: unknown, input: unknown): unknown {
  if (Array.isArray(def)) {
    return Array.isArray(input) && input.every((x) => typeof x === 'string')
      ? [...input]
      : [...def];
  }
  if (isObj(def)) {
    const src = isObj(input) ? input : {};
    const out: Obj = {};
    for (const key of Object.keys(def)) out[key] = mergeTyped(def[key], src[key]);
    return out;
  }
  if (def === null) return input ?? null;
  return typeof input === typeof def ? input : def;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}
