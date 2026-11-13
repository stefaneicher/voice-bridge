// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Recorder } from '../../../src/renderer/recorder/recorder';

describe('Recorder', () => {
  const mediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (mediaDevices) Object.defineProperty(navigator, 'mediaDevices', mediaDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('captures audio as soon as the audio context resumes', async () => {
    let processAudio!: (event: { inputBuffer: { getChannelData: () => Float32Array } }) => void;
    let resume!: () => void;
    const resumePending = new Promise<void>((resolve) => (resume = resolve));
    const frame = new Float32Array(2048).fill(0.25);
    const processor = {
      onaudioprocess: null as
        ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    class FakeAudioContext {
      sampleRate = 16_000;
      destination = {};

      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }

      createScriptProcessor() {
        return processor;
      }

      createGain() {
        return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      }

      resume() {
        processAudio = processor.onaudioprocess!;
        return resumePending;
      }

      close() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal('AudioContext', FakeAudioContext);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
    vi.spyOn(performance, 'now').mockReturnValue(100);
    window.vbRecorder = {
      onCommand: () => () => {},
      reply: () => {},
      level: vi.fn(),
      pcm: vi.fn(),
      ready: () => {},
    };

    const recorder = new Recorder();
    const starting = recorder.handle({
      id: 1,
      type: 'start',
      deviceId: 'default',
    });
    await vi.waitFor(() => expect(processAudio).toBeDefined());

    processAudio({ inputBuffer: { getChannelData: () => frame } });
    resume();
    await expect(starting).resolves.toEqual({ id: 1, ok: true });

    const result = await recorder.handle({ id: 2, type: 'stop' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.wav?.byteLength).toBe(44 + frame.length * 2);

    const retry = await recorder.handle({ id: 3, type: 'stop' });
    expect(retry).toEqual({ ...result, id: 3 });
    await recorder.handle({ id: 4, type: 'ack' });
  });
});
