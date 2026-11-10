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

const VK_NAMES: Record<number, string> = {
  0x08: 'Rücktaste',
  0x09: 'Tab',
  0x0d: 'Enter',
  0x13: 'Pause',
  0x14: 'Feststelltaste',
  0x1b: 'Esc',
  0x20: 'Leertaste',
  0x21: 'Bild auf',
  0x22: 'Bild ab',
  0x23: 'Ende',
  0x24: 'Pos1',
  0x2c: 'Druck',
  0x2d: 'Einfg',
  0x2e: 'Entf',
  0x5b: 'Win links',
  0x5c: 'Win rechts',
  0x5d: 'Menü',
  0x90: 'Num',
  0x91: 'Rollen',
  0xa0: 'Umschalt links',
  0xa1: 'Umschalt rechts',
  0xa2: 'Strg links',
  0xa3: 'Strg rechts',
  0xa4: 'Alt links',
  0xa5: 'Alt Gr',
};

/** Human-readable name of a Win32 virtual key code. */
export function windowsKeyLabel(vk: number): string {
  if (vk >= 0x70 && vk <= 0x87) return `F${vk - 0x6f}`;
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
  if (vk >= 0x60 && vk <= 0x69) return `Num ${vk - 0x60}`;
  return VK_NAMES[vk] ?? `Taste ${vk}`;
}
