import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, normalizeConfig } from '../../../src/shared/config';

describe('normalizeConfig', () => {
  it('returns defaults for missing or broken input', () => {
    expect(normalizeConfig(undefined, 'privat')).toEqual(defaultConfig('privat'));
    expect(normalizeConfig('garbage', 'privat')).toEqual(defaultConfig('privat'));
  });

  it('keeps valid values, replaces wrong types and drops unknown keys', () => {
    const c = normalizeConfig(
      {
        profile: 'other',
        hotkeys: { dictate: { device: 'keyboard', keycode: 124, label: 'F13' }, minHoldMs: '5' },
        stt: { model: 'whisper-1', glossary: ['A', 3], polish: { enabled: false } },
        evil: true,
      },
      'citrix',
    );
    expect(c.profile).toBe('citrix');
    expect(c.hotkeys.dictate).toEqual({ device: 'keyboard', keycode: 124, label: 'F13' });
    expect(c.hotkeys.minHoldMs).toBe(300);
    // Retired by OpenAI on 26 Feb 2027: moved to the successor.
    expect(c.stt.model).toBe('gpt-transcribe');
    expect(c.stt.glossary).toEqual(defaultConfig('x').stt.glossary);
    expect(c.stt.polish.enabled).toBe(false);
    expect(c.stt.polish.model).toBe('gpt-4o-mini');
    expect(c).not.toHaveProperty('evil');
  });

  it('clamps numbers and rejects invalid bindings', () => {
    const c = normalizeConfig(
      { hotkeys: { agent: { device: 'mouse', button: 'Left' }, maxRecordingSec: 99999 } },
      'p',
    );
    expect(c.hotkeys.agent).toEqual({ device: 'mouse', button: 'XButton2' });
    expect(c.hotkeys.maxRecordingSec).toBe(600);
  });

  it('keeps valid modifiers of a combination and drops invalid ones', () => {
    const c = normalizeConfig(
      {
        hotkeys: {
          dictate: { device: 'keyboard', keycode: 68, modifiers: ['shift', 'evil', 'ctrl'] },
          agent: { device: 'mouse', button: 'Middle', modifiers: 'ctrl' },
        },
      },
      'p',
    );
    expect(c.hotkeys.dictate).toEqual({
      device: 'keyboard',
      keycode: 68,
      modifiers: ['ctrl', 'shift'],
    });
    expect(c.hotkeys.agent).toEqual({ device: 'mouse', button: 'Middle' });
  });

  it('reads the documented example', () => {
    const example = JSON.parse(
      readFileSync(join(__dirname, '../../../examples/config.example.json'), 'utf8'),
    ) as unknown;
    const c = normalizeConfig(example, 'privat');
    expect(c.hotkeys.agent).toEqual({ device: 'mouse', button: 'XButton2' });
    expect(c.stt.glossary).toContain('Firstmate');
    expect(c.stt.showRawTranscript).toBe(true);
  });
});
