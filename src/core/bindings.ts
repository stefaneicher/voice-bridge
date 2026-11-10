import type { HotkeyAction, HotkeyBinding, MouseButton } from './types';

/** A raw button or key event as seen by an OS hook, before it is mapped to a mode. */
export type RawInput =
  | { device: 'mouse'; button: MouseButton; down: boolean }
  | { device: 'keyboard'; keycode: number; down: boolean };

export type Bindings = Record<HotkeyAction, HotkeyBinding>;

/** Returns the mode a raw event belongs to, or null if it is not bound. */
export function matchBinding(raw: RawInput, bindings: Bindings): HotkeyAction | null {
  for (const action of ['dictate', 'agent'] as const) {
    const b = bindings[action];
    if (raw.device === 'mouse' && b.device === 'mouse' && b.button === raw.button) return action;
    if (raw.device === 'keyboard' && b.device === 'keyboard' && b.keycode === raw.keycode) {
      return action;
    }
  }
  return null;
}

const MOUSE_LABELS: Record<MouseButton, string> = {
  XButton1: 'Maus 4',
  XButton2: 'Maus 5',
  Middle: 'Mittlere Maustaste',
};

export function bindingLabel(b: HotkeyBinding): string {
  if (b.device === 'mouse') return MOUSE_LABELS[b.button];
  return b.label ?? `Taste ${b.keycode}`;
}
