import type { Bindings, HotkeyAction, InputEvent, Modifier, MouseButton, RawInput } from '../core';
import { matchBinding, normalizeModifiers } from '../core';

/** Win32 message IDs used by the low-level hooks. */
export const WM = {
  KEYDOWN: 0x0100,
  KEYUP: 0x0101,
  SYSKEYDOWN: 0x0104,
  SYSKEYUP: 0x0105,
  MOUSEWHEEL: 0x020a,
  MBUTTONDOWN: 0x0207,
  MBUTTONUP: 0x0208,
  XBUTTONDOWN: 0x020b,
  XBUTTONUP: 0x020c,
} as const;

/** Decodes a low-level mouse message. Returns null for messages we do not care about. */
export function decodeMouse(
  wParam: number,
  mouseData: number,
): { raw: RawInput } | { wheel: 1 | -1 } | null {
  const hi = (mouseData >>> 16) & 0xffff;
  switch (wParam) {
    case WM.XBUTTONDOWN:
    case WM.XBUTTONUP: {
      const button: MouseButton | null = hi === 1 ? 'XButton1' : hi === 2 ? 'XButton2' : null;
      if (!button) return null;
      return { raw: { device: 'mouse', button, down: wParam === WM.XBUTTONDOWN } };
    }
    case WM.MBUTTONDOWN:
    case WM.MBUTTONUP:
      return { raw: { device: 'mouse', button: 'Middle', down: wParam === WM.MBUTTONDOWN } };
    case WM.MOUSEWHEEL: {
      const delta = hi >= 0x8000 ? hi - 0x10000 : hi;
      if (delta === 0) return null;
      // Wheel towards the user (negative) moves down the list.
      return { wheel: delta < 0 ? 1 : -1 };
    }
    default:
      return null;
  }
}

export function decodeKey(wParam: number, vkCode: number): RawInput | null {
  if (wParam === WM.KEYDOWN || wParam === WM.SYSKEYDOWN) {
    return { device: 'keyboard', keycode: vkCode, down: true };
  }
  if (wParam === WM.KEYUP || wParam === WM.SYSKEYUP) {
    return { device: 'keyboard', keycode: vkCode, down: false };
  }
  return null;
}

/** Result of a capture in the settings dialog: the trigger plus the modifiers held with it. */
export interface CapturedInput {
  raw: RawInput;
  modifiers: Modifier[];
}

const keyOf = (raw: RawInput) => (raw.device === 'mouse' ? `m:${raw.button}` : `k:${raw.keycode}`);

/**
 * Hook decision logic shared by all OS hooks: maps raw events to mode events, tracks held
 * modifiers, filters key repeats and decides whether the original event must be swallowed.
 * No I/O, must be fast.
 */
export class HookState {
  /** Bound triggers currently held, with the mode they started. */
  private readonly held = new Map<string, HotkeyAction>();
  /** Modifier keys currently down (keycode → group), in press order. */
  private readonly mods = new Map<number, Modifier>();
  /** Keys swallowed while capturing; their release is swallowed too. */
  private readonly swallowUp = new Set<string>();
  private captureCb: ((c: CapturedInput) => void) | null = null;
  wheelCapture = false;

  constructor(
    public bindings: Bindings,
    private readonly modifierOf: (keycode: number) => Modifier | null = () => null,
    /** Optional OS check to drop modifiers whose release the hook never saw (e.g. Win+L). */
    private readonly stillDown: (keycode: number) => boolean = () => true,
  ) {}

  /** One-shot capture for the settings dialog ("Tasten drücken …"). */
  startCapture(cb: (c: CapturedInput) => void): void {
    this.captureCb = cb;
  }

  cancelCapture(): void {
    this.captureCb = null;
  }

  /** Returns the event to emit (if any) and whether to suppress the original OS event. */
  onRaw(raw: RawInput): { event: InputEvent | null; suppress: boolean } {
    const mod = raw.device === 'keyboard' ? this.modifierOf(raw.keycode) : null;
    if (raw.device === 'keyboard' && mod && raw.down && !this.mods.has(raw.keycode)) {
      this.mods.set(raw.keycode, mod);
    }
    try {
      return this.decide(raw, mod);
    } finally {
      if (raw.device === 'keyboard' && mod && !raw.down) this.mods.delete(raw.keycode);
    }
  }

  onWheel(delta: 1 | -1): { event: InputEvent | null; suppress: boolean } {
    if (!this.wheelCapture) return { event: null, suppress: false };
    return { event: { type: 'wheel', delta }, suppress: true };
  }

  private decide(
    raw: RawInput,
    mod: Modifier | null,
  ): { event: InputEvent | null; suppress: boolean } {
    const key = keyOf(raw);
    if (this.captureCb) {
      if (raw.down) {
        this.swallowUp.add(key);
        if (!mod) this.finishCapture({ raw, modifiers: [...this.heldModifiers(raw)] });
        return { event: null, suppress: true };
      }
      if (mod && raw.device === 'keyboard') {
        // Only modifiers were pressed (e.g. "Strg rechts" or "Strg + Alt"): the last one pressed
        // becomes the trigger, the others are its modifiers.
        const keys = [...this.mods.keys()];
        const trigger = keys[keys.length - 1] ?? raw.keycode;
        const others = new Set([...this.mods].filter(([k]) => k !== trigger).map(([, m]) => m));
        this.finishCapture({
          raw: { device: 'keyboard', keycode: trigger, down: true },
          modifiers: normalizeModifiers(others),
        });
        this.swallowUp.delete(key);
        return { event: null, suppress: true };
      }
    }
    if (!raw.down && this.swallowUp.delete(key)) return { event: null, suppress: true };

    if (raw.down) {
      if (this.held.has(key)) return { event: null, suppress: true }; // auto-repeat
      const action = matchBinding(raw, this.bindings, this.heldModifiers(raw));
      if (!action) return { event: null, suppress: false };
      this.held.set(key, action);
      return { event: { type: 'down', action }, suppress: true };
    }
    const action = this.held.get(key);
    if (!action) return { event: null, suppress: false };
    this.held.delete(key);
    return { event: { type: 'up', action }, suppress: true };
  }

  private finishCapture(c: CapturedInput): void {
    const cb = this.captureCb;
    this.captureCb = null;
    if (cb) queueMicrotask(() => cb({ raw: c.raw, modifiers: normalizeModifiers(c.modifiers) }));
  }

  /** Modifier groups held besides the event's own key. */
  private heldModifiers(raw: RawInput): Set<Modifier> {
    const out = new Set<Modifier>();
    if (!this.mods.size) return out;
    for (const [code, m] of this.mods) {
      if (raw.device === 'keyboard' && code === raw.keycode) continue;
      if (!this.stillDown(code)) {
        this.mods.delete(code);
        continue;
      }
      out.add(m);
    }
    return out;
  }
}
