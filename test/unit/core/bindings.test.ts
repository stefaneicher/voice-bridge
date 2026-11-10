import { describe, expect, it } from 'vitest';
import { bindingLabel, matchBinding, windowsKeyLabel, type Bindings } from '../../../src/core';

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
  });
  it('names Win32 virtual keys', () => {
    expect(windowsKeyLabel(0x7c)).toBe('F13');
    expect(windowsKeyLabel(0x41)).toBe('A');
    expect(windowsKeyLabel(0x63)).toBe('Num 3');
    expect(windowsKeyLabel(0xa5)).toBe('Alt Gr');
    expect(windowsKeyLabel(0xff)).toBe('Taste 255');
  });
});
