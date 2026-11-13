import type { AudioClip } from '../core/types';

const MIN_RMS = 10 ** (-48 / 20);
const MIN_ACTIVITY_MS = 100;
const WINDOW_MS = 20;

/** Returns null for formats this lightweight PCM detector cannot inspect. */
export function hasVoiceActivity(clip: AudioClip): boolean | null {
  const data = clip.data;
  if (clip.mimeType !== 'audio/wav' || data.length < 44) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') return null;

  let format: number | undefined;
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let bitsPerSample: number | undefined;
  let pcmOffset: number | undefined;
  let pcmLength: number | undefined;

  for (let offset = 12; offset + 8 <= data.length;) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size > data.length - start) return null;

    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bitsPerSample = view.getUint16(start + 14, true);
    } else if (id === 'data') {
      pcmOffset = start;
      pcmLength = size;
    }

    offset = start + size + (size % 2);
  }

  if (
    format !== 1 ||
    channels !== 1 ||
    bitsPerSample !== 16 ||
    !sampleRate ||
    pcmOffset === undefined ||
    pcmLength === undefined
  ) {
    return null;
  }

  const samples = Math.floor(pcmLength / 2);
  const windowSize = Math.max(1, Math.round((sampleRate * WINDOW_MS) / 1000));
  let activeMs = 0;

  for (let start = 0; start < samples; start += windowSize) {
    const count = Math.min(windowSize, samples - start);
    let squares = 0;
    for (let i = 0; i < count; i++) {
      const sample = view.getInt16(pcmOffset + (start + i) * 2, true) / 32768;
      squares += sample * sample;
    }
    if (Math.sqrt(squares / count) >= MIN_RMS) activeMs += (count * 1000) / sampleRate;
    if (activeMs >= MIN_ACTIVITY_MS) return true;
  }

  return false;
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
