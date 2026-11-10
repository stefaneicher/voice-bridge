import type { Bindings, InputEvent, MouseButton, RawInput } from '../core';
import { matchBinding } from '../core';

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

/**
 * Hook decision logic shared by all OS hooks: maps raw events to mode events, filters key
 * repeats and decides whether the original event must be swallowed. No I/O, must be fast.
 */
export class HookState {
  private readonly held = new Set<string>();
  wheelCapture = false;
  /** One-shot capture for the settings dialog ("Taste drücken …"). */
  captureNext: ((raw: RawInput) => void) | null = null;

  constructor(public bindings: Bindings) {}

  /** Returns the event to emit (if any) and whether to suppress the original OS event. */
  onRaw(raw: RawInput): { event: InputEvent | null; suppress: boolean } {
    if (this.captureNext && raw.down) {
      const cb = this.captureNext;
      this.captureNext = null;
      queueMicrotask(() => cb(raw));
      return { event: null, suppress: true };
    }
    const action = matchBinding(raw, this.bindings);
    if (!action) return { event: null, suppress: false };
    const key = raw.device === 'mouse' ? `m:${raw.button}` : `k:${raw.keycode}`;
    if (raw.down) {
      if (this.held.has(key)) return { event: null, suppress: true }; // auto-repeat
      this.held.add(key);
      return { event: { type: 'down', action }, suppress: true };
    }
    if (!this.held.delete(key)) return { event: null, suppress: true };
    return { event: { type: 'up', action }, suppress: true };
  }

  onWheel(delta: 1 | -1): { event: InputEvent | null; suppress: boolean } {
    if (!this.wheelCapture) return { event: null, suppress: false };
    return { event: { type: 'wheel', delta }, suppress: true };
  }
}
