import { describe, expect, it } from 'vitest';
import {
  bindingLabel,
  matchBinding,
  normalizeModifiers,
  sameBinding,
  uiohookModifier,
  windowsKeyLabel,
  windowsModifier,
  type Bindings,
} from '../../../src/core';

const bindings: Bindings = {
  dictate: { device: 'mouse', button: 'XButton1' },
  agent: { device: 'keyboard', keycode: 0x7c, label: 'F13' },
};

describe('bindings', () => {
  it('maps raw input to modes', () => {
    expect(matchBinding({ device: 'mouse', button: 'XButton1', down: true }, bindings)).toBe(
      'dictate',
    );
    expect(matchBinding({ device: 'keyboard', keycode: 0x7c, down: false }, bindings)).toBe(
      'agent',
    );
    expect(matchBinding({ device: 'mouse', button: 'XButton2', down: true }, bindings)).toBeNull();
  });
  it('labels bindings for the UI', () => {
    expect(bindingLabel(bindings.dictate)).toBe('Maus 4');
    expect(bindingLabel(bindings.agent)).toBe('F13');
    expect(bindingLabel({ device: 'keyboard', keycode: 65 })).toBe('Taste 65');
    expect(
      bindingLabel({ device: 'keyboard', keycode: 0x44, label: 'D', modifiers: ['shift', 'ctrl'] }),
    ).toBe('Strg + Umschalt + D');
    expect(bindingLabel({ device: 'mouse', button: 'Middle', modifiers: ['alt'] })).toBe(
      'Alt + Mittlere Maustaste',
    );
  });
  it('requires the exact modifiers of a combination', () => {
    const chord: Bindings = {
      dictate: { device: 'keyboard', keycode: 0x44, modifiers: ['ctrl', 'shift'] },
      agent: { device: 'mouse', button: 'XButton2' },
    };
    const d = { device: 'keyboard', keycode: 0x44, down: true } as const;
    expect(matchBinding(d, chord)).toBeNull();
    expect(matchBinding(d, chord, new Set(['ctrl']))).toBeNull();
    expect(matchBinding(d, chord, new Set(['shift', 'ctrl']))).toBe('dictate');
    expect(matchBinding(d, chord, new Set(['shift', 'ctrl', 'alt']))).toBeNull();
    const x2 = { device: 'mouse', button: 'XButton2', down: true } as const;
    expect(matchBinding(x2, chord, new Set(['ctrl']))).toBeNull();
  });
  it('compares bindings and maps modifier keys', () => {
    expect(
      sameBinding(
        { device: 'keyboard', keycode: 1, modifiers: ['shift', 'ctrl'] },
        { device: 'keyboard', keycode: 1, label: 'x', modifiers: ['ctrl', 'shift'] },
      ),
    ).toBe(true);
    expect(
      sameBinding(bindings.dictate, { device: 'mouse', button: 'XButton1', modifiers: ['alt'] }),
    ).toBe(false);
    expect(normalizeModifiers(['win', 'ctrl', 'ctrl', 'bogus'])).toEqual(['ctrl', 'win']);
    expect([0xa0, 0xa3, 0xa5, 0x5b, 0x41].map(windowsModifier)).toEqual([
      'shift',
      'ctrl',
      'alt',
      'win',
      null,
    ]);
    expect([42, 3613, 56, 3676, 30].map(uiohookModifier)).toEqual([
      'shift',
      'ctrl',
      'alt',
      'win',
      null,
    ]);
  });
  it('names Win32 virtual keys', () => {
    expect(windowsKeyLabel(0x7c)).toBe('F13');
    expect(windowsKeyLabel(0x41)).toBe('A');
    expect(windowsKeyLabel(0x63)).toBe('Num 3');
    expect(windowsKeyLabel(0xa5)).toBe('Alt Gr');
    expect(windowsKeyLabel(0xff)).toBe('Taste 255');
  });
});
