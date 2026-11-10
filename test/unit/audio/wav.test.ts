import { describe, expect, it } from 'vitest';
import { encodeWav, level, resample } from '../../../src/audio/wav';

describe('wav', () => {
  it('writes a valid 16-bit mono header', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    const view = new DataView(wav.buffer);
    const ascii = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(ascii(0)).toBe('RIFF');
    expect(ascii(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });
  it('resamples 48 kHz to 16 kHz', () => {
    expect(resample(new Float32Array(48000), 48000, 16000)).toHaveLength(16000);
    const same = new Float32Array(3);
    expect(resample(same, 16000, 16000)).toBe(same);
  });
  it('computes a bounded level', () => {
    expect(level(new Float32Array())).toBe(0);
    expect(level(new Float32Array([1, -1]))).toBe(1);
  });
});
