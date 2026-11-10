import type { HotkeyAction, HotkeyBinding, Modifier, MouseButton } from './types';

/** A raw button or key event as seen by an OS hook, before it is mapped to a mode. */
export type RawInput =
  | { device: 'mouse'; button: MouseButton; down: boolean }
  | { device: 'keyboard'; keycode: number; down: boolean };

export type Bindings = Record<HotkeyAction, HotkeyBinding>;

/** Canonical modifier order, used for comparison and labels. */
export const MODIFIERS: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'win'];

export const MODIFIER_LABELS: Record<Modifier, string> = {
  ctrl: 'Strg',
  alt: 'Alt',
  shift: 'Umschalt',
  win: 'Win',
};

/** Removes duplicates and unknown values and sorts into canonical order. */
export function normalizeModifiers(mods: Iterable<unknown>): Modifier[] {
  const set = new Set(mods);
  return MODIFIERS.filter((m) => set.has(m));
}

function sameModifiers(a: readonly Modifier[] | undefined, held: ReadonlySet<Modifier>): boolean {
  const want = a ?? [];
  return want.length === held.size && want.every((m) => held.has(m));
}

/**
 * Returns the mode a raw event belongs to, or null if it is not bound. `held` are the modifiers
 * pressed besides the event's own key; they must match the binding exactly.
 */
export function matchBinding(
  raw: RawInput,
  bindings: Bindings,
  held: ReadonlySet<Modifier> = new Set(),
): HotkeyAction | null {
  for (const action of ['dictate', 'agent'] as const) {
    const b = bindings[action];
    const sameInput =
      (raw.device === 'mouse' && b.device === 'mouse' && b.button === raw.button) ||
      (raw.device === 'keyboard' && b.device === 'keyboard' && b.keycode === raw.keycode);
    if (sameInput && sameModifiers(b.modifiers, held)) return action;
  }
  return null;
}

export function sameBinding(a: HotkeyBinding, b: HotkeyBinding): boolean {
  const input =
    (a.device === 'mouse' && b.device === 'mouse' && a.button === b.button) ||
    (a.device === 'keyboard' && b.device === 'keyboard' && a.keycode === b.keycode);
  return input && sameModifiers(a.modifiers, new Set(b.modifiers ?? []));
}

const MOUSE_LABELS: Record<MouseButton, string> = {
  XButton1: 'Maus 4',
  XButton2: 'Maus 5',
  Middle: 'Mittlere Maustaste',
};

export function bindingLabel(b: HotkeyBinding): string {
  const main = b.device === 'mouse' ? MOUSE_LABELS[b.button] : (b.label ?? `Taste ${b.keycode}`);
  const mods = normalizeModifiers(b.modifiers ?? []).map((m) => MODIFIER_LABELS[m]);
  return [...mods, main].join(' + ');
}

/** Modifier group of a Win32 virtual key, or null. */
export function windowsModifier(vk: number): Modifier | null {
  switch (vk) {
    case 0x10:
    case 0xa0:
    case 0xa1:
      return 'shift';
    case 0x11:
    case 0xa2:
    case 0xa3:
      return 'ctrl';
    case 0x12:
    case 0xa4:
    case 0xa5:
      return 'alt';
    case 0x5b:
    case 0x5c:
      return 'win';
    default:
      return null;
  }
}

/** Modifier group of a uiohook keycode (libuiohook VC_* values), or null. */
export function uiohookModifier(code: number): Modifier | null {
  switch (code) {
    case 0x002a:
    case 0x0036:
      return 'shift';
    case 0x001d:
    case 0x0e1d:
      return 'ctrl';
    case 0x0038:
    case 0x0e38:
      return 'alt';
    case 0x0e5b:
    case 0x0e5c:
      return 'win';
    default:
      return null;
  }
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
