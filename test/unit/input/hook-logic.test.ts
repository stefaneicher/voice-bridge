import { describe, expect, it } from 'vitest';
import { windowsModifier, type Bindings } from '../../../src/core';
import { HookState, WM, decodeKey, decodeMouse } from '../../../src/input/hook-logic';

const bindings = {
  dictate: { device: 'mouse', button: 'XButton1' },
  agent: { device: 'mouse', button: 'XButton2' },
} as const;

describe('Win32 decoding', () => {
  it('decodes X buttons and wheel direction', () => {
    expect(decodeMouse(WM.XBUTTONDOWN, 1 << 16)).toEqual({
      raw: { device: 'mouse', button: 'XButton1', down: true },
    });
    expect(decodeMouse(WM.XBUTTONUP, 2 << 16)).toEqual({
      raw: { device: 'mouse', button: 'XButton2', down: false },
    });
    expect(decodeMouse(WM.MOUSEWHEEL, (0x10000 - 120) << 16)).toEqual({ wheel: 1 });
    expect(decodeMouse(WM.MOUSEWHEEL, 120 << 16)).toEqual({ wheel: -1 });
    expect(decodeMouse(0x0200, 0)).toBeNull();
  });
  it('decodes keys', () => {
    expect(decodeKey(WM.SYSKEYDOWN, 0x7c)).toEqual({
      device: 'keyboard',
      keycode: 0x7c,
      down: true,
    });
    expect(decodeKey(0x999, 1)).toBeNull();
  });
});

describe('HookState', () => {
  it('suppresses bound buttons and filters repeats', () => {
    const s = new HookState({ ...bindings });
    expect(s.onRaw({ device: 'mouse', button: 'XButton1', down: true })).toEqual({
      event: { type: 'down', action: 'dictate' },
      suppress: true,
    });
    expect(s.onRaw({ device: 'mouse', button: 'XButton1', down: true })).toEqual({
      event: null,
      suppress: true,
    });
    expect(s.onRaw({ device: 'mouse', button: 'XButton1', down: false }).event).toEqual({
      type: 'up',
      action: 'dictate',
    });
    expect(s.onRaw({ device: 'mouse', button: 'Middle', down: true })).toEqual({
      event: null,
      suppress: false,
    });
  });
  it('swallows the wheel only while captured', () => {
    const s = new HookState({ ...bindings });
    expect(s.onWheel(1)).toEqual({ event: null, suppress: false });
    s.wheelCapture = true;
    expect(s.onWheel(-1)).toEqual({ event: { type: 'wheel', delta: -1 }, suppress: true });
  });
  it('captures the next key for the settings dialog', async () => {
    const s = new HookState({ ...bindings });
    const got = new Promise((r) => s.startCapture(r));
    expect(s.onRaw({ device: 'keyboard', keycode: 0x7d, down: true })).toEqual({
      event: null,
      suppress: true,
    });
    expect(await got).toEqual({
      raw: { device: 'keyboard', keycode: 0x7d, down: true },
      modifiers: [],
    });
    // The release of the captured key is swallowed as well.
    expect(s.onRaw({ device: 'keyboard', keycode: 0x7d, down: false }).suppress).toBe(true);
  });
});

describe('HookState with key combinations', () => {
  const CTRL = 0xa2;
  const SHIFT = 0xa0;
  const D = 0x44;
  const chord: Bindings = {
    dictate: { device: 'keyboard', keycode: D, label: 'D', modifiers: ['ctrl', 'shift'] },
    agent: { device: 'mouse', button: 'XButton1', modifiers: ['ctrl'] },
  };
  const key = (keycode: number, down: boolean) => ({ device: 'keyboard', keycode, down }) as const;

  it('fires only when exactly the bound modifiers are held and never swallows them', () => {
    const s = new HookState({ ...chord }, windowsModifier);
    expect(s.onRaw(key(D, true))).toEqual({ event: null, suppress: false });
    expect(s.onRaw(key(D, false))).toEqual({ event: null, suppress: false });

    expect(s.onRaw(key(CTRL, true))).toEqual({ event: null, suppress: false });
    expect(s.onRaw(key(D, true))).toEqual({ event: null, suppress: false }); // Ctrl+D only
    s.onRaw(key(D, false));
    expect(s.onRaw(key(SHIFT, true))).toEqual({ event: null, suppress: false });
    expect(s.onRaw(key(D, true))).toEqual({
      event: { type: 'down', action: 'dictate' },
      suppress: true,
    });
    expect(s.onRaw(key(D, true))).toEqual({ event: null, suppress: true }); // auto-repeat
    // Releasing a modifier first does not end the recording; releasing the trigger does.
    expect(s.onRaw(key(CTRL, false))).toEqual({ event: null, suppress: false });
    expect(s.onRaw(key(D, false))).toEqual({
      event: { type: 'up', action: 'dictate' },
      suppress: true,
    });
  });

  it('combines modifiers with mouse buttons', () => {
    const s = new HookState({ ...chord }, windowsModifier);
    const x1 = (down: boolean) => ({ device: 'mouse', button: 'XButton1', down }) as const;
    expect(s.onRaw(x1(true))).toEqual({ event: null, suppress: false });
    s.onRaw(x1(false));
    s.onRaw(key(0xa3, true)); // right Ctrl counts as Ctrl
    expect(s.onRaw(x1(true)).event).toEqual({ type: 'down', action: 'agent' });
    expect(s.onRaw(x1(false)).event).toEqual({ type: 'up', action: 'agent' });
  });

  it('drops modifiers the OS no longer reports as held', () => {
    const down = new Set<number>([CTRL, SHIFT]);
    const s = new HookState({ ...chord }, windowsModifier, (vk) => down.has(vk));
    s.onRaw(key(CTRL, true));
    s.onRaw(key(SHIFT, true));
    down.delete(SHIFT); // release missed by the hook (e.g. secure desktop)
    expect(s.onRaw(key(D, true)).event).toBeNull();
  });

  it('captures a combination with modifiers', async () => {
    const s = new HookState({ ...chord }, windowsModifier);
    const got = new Promise((r) => s.startCapture(r));
    expect(s.onRaw(key(SHIFT, true)).suppress).toBe(true);
    expect(s.onRaw(key(CTRL, true)).suppress).toBe(true);
    expect(s.onRaw(key(0x4b, true)).suppress).toBe(true);
    expect(await got).toEqual({ raw: key(0x4b, true), modifiers: ['ctrl', 'shift'] });
    for (const k of [0x4b, CTRL, SHIFT]) expect(s.onRaw(key(k, false)).suppress).toBe(true);
    // After capture, normal keys pass again.
    expect(s.onRaw(key(0x4b, true)).suppress).toBe(false);
  });

  it('captures a modifier combination with a mouse button', async () => {
    const s = new HookState({ ...chord }, windowsModifier);
    const got = new Promise((r) => s.startCapture(r));
    s.onRaw(key(0xa4, true));
    s.onRaw({ device: 'mouse', button: 'Middle', down: true });
    expect(await got).toEqual({
      raw: { device: 'mouse', button: 'Middle', down: true },
      modifiers: ['alt'],
    });
    expect(s.onRaw({ device: 'mouse', button: 'Middle', down: false }).suppress).toBe(true);
  });

  it('captures modifier-only combinations on release', async () => {
    const s = new HookState({ ...chord }, windowsModifier);
    const got = new Promise((r) => s.startCapture(r));
    s.onRaw(key(CTRL, true));
    s.onRaw(key(0xa5, true)); // Alt Gr pressed last becomes the trigger
    expect(s.onRaw(key(0xa5, false)).suppress).toBe(true);
    expect(await got).toEqual({ raw: key(0xa5, true), modifiers: ['ctrl'] });
    expect(s.onRaw(key(CTRL, false)).suppress).toBe(true);
  });

  it('allows a single modifier key as trigger', () => {
    const s = new HookState(
      { ...chord, dictate: { device: 'keyboard', keycode: 0xa3 } },
      windowsModifier,
    );
    expect(s.onRaw(key(0xa3, true)).event).toEqual({ type: 'down', action: 'dictate' });
    expect(s.onRaw(key(0xa3, false)).event).toEqual({ type: 'up', action: 'dictate' });
  });
});
