import { describe, expect, it } from 'vitest';
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
    const got = new Promise((r) => (s.captureNext = r));
    expect(s.onRaw({ device: 'keyboard', keycode: 0x7d, down: true })).toEqual({
      event: null,
      suppress: true,
    });
    expect(await got).toEqual({ device: 'keyboard', keycode: 0x7d, down: true });
  });
});
