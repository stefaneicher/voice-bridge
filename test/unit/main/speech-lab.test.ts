import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav } from '../../../src/audio/wav';
import type { AudioClip, Transcript } from '../../../src/core';
import { SpeechLab, type LabPipeline } from '../../../src/main/speech-lab';
import { SpeechLabStore, labPackage } from '../../../src/main/speech-lab-store';
import { defaultConfig } from '../../../src/shared/config';
import { labSettings } from '../../../src/shared/speech-lab';

const clip: AudioClip = {
  data: encodeWav(new Float32Array([0.3, -0.3]), 16000),
  durationMs: 200,
  mimeType: 'audio/wav',
};

function setup() {
  let time = 1000;
  const store = new SpeechLabStore('unused');
  vi.spyOn(store, 'list').mockReturnValue({ entries: [] });
  const save = vi.spyOn(store, 'save').mockImplementation(() => {});
  const changed = vi.fn();
  const lab = new SpeechLab(store, changed, () => time);
  const settings = labSettings(defaultConfig('privat'));
  const pipeline: LabPipeline = {
    recorder: {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => clip),
      cancel: vi.fn(),
    },
    stt: { transcribe: vi.fn(async () => ({ text: 'Bitte prüfen.' })) },
  };
  let preview!: (text: string) => void;
  let event!: (name: string) => void;
  const create = vi.fn((onPreview: typeof preview, onEvent: typeof event) => {
    preview = onPreview;
    event = onEvent;
    return pipeline;
  });
  return {
    lab,
    store,
    save,
    settings,
    pipeline,
    create,
    changed,
    time: (value: number) => (time = value),
    preview: (text: string) => preview(text),
    event: (name: string) => event(name),
  };
}

afterEach(() => vi.useRealTimers());

describe('speech lab lifecycle and privacy', () => {
  it('requires an isolated mode, a sentence and explicit cloud consent before opening anything', async () => {
    const t = setup();
    await expect(t.lab.start('Hallo', true, t.settings, t.create)).rejects.toThrow('bereit');
    t.lab.enter();
    await expect(t.lab.start('Hallo', false, t.settings, t.create)).rejects.toThrow('Cloud');
    await expect(t.lab.start(' ', true, t.settings, t.create)).rejects.toThrow('Testsatz');
    expect(t.create).not.toHaveBeenCalled();
    expect(t.save).not.toHaveBeenCalled();
  });

  it('records distinct monotonic preview snapshots and release/final timestamps without saving', async () => {
    const t = setup();
    t.lab.enter();
    await t.lab.start('Bitte prüfen.', true, t.settings, t.create);
    t.time(1250);
    t.preview('Bitte');
    t.preview('Bitte');
    t.time(1400);
    t.preview('Bitte prüfen');
    let finish!: (value: Transcript) => void;
    vi.mocked(t.pipeline.stt.transcribe).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    t.time(1500);
    const stopping = t.lab.stop();
    await Promise.resolve();
    expect(t.lab.state().phase).toBe('finishing');
    expect(t.lab.state().current?.releasedAtMs).toBe(500);
    t.time(1700);
    finish({ text: 'Bitte prüfen.', raw: 'Bitte prüefe' });
    await stopping;
    const result = t.lab.state();
    expect(result.current?.previews).toEqual([
      { text: 'Bitte', atMs: 250 },
      { text: 'Bitte prüfen', atMs: 400 },
    ]);
    expect(result.current).toMatchObject({
      expected: 'Bitte prüfen.',
      finalText: 'Bitte prüfen.',
      rawText: 'Bitte prüefe',
      releasedAtMs: 500,
      finalAtMs: 700,
      durationMs: 200,
    });
    expect(result.current?.events.map((e) => e.name)).toEqual([
      'start-requested',
      'recording',
      'release',
      'audio-ready',
      'final',
    ]);
    expect(result.hasAudio).toBe(true);
    expect(result.saved).toBe(false);
    expect(t.save).not.toHaveBeenCalled();
    expect(() => t.lab.exit()).toThrow('verwerfen');
    await expect(t.lab.start('Weiter', true, t.settings, t.create)).rejects.toThrow('bereit');
    t.lab.discard();
    expect(t.lab.state().hasAudio).toBe(false);
    t.lab.exit();
    expect(t.lab.active).toBe(false);
  });

  it('saves audio only with per-recording consent; review changes require another explicit save', async () => {
    const t = setup();
    t.lab.enter();
    await t.lab.start('Bitte prüfen.', true, t.settings, t.create);
    await t.lab.stop();
    expect(() => t.lab.save('true')).toThrow('Zustimmung');
    expect(t.save).not.toHaveBeenCalled();
    t.lab.review('correct', 'Alles korrekt');
    t.lab.save(true);
    expect(t.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ review: 'correct', correction: 'Alles korrekt' }),
      clip,
      true,
    );
    expect(t.lab.state().saved).toBe(true);
    t.lab.review('incorrect', 'Ein Wort fehlt.');
    expect(t.lab.state().saved).toBe(false);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(() => t.lab.review('invalid', '')).toThrow('Bewertung');
  });

  it('retains audio and previews after STT failure and a failed save', async () => {
    const t = setup();
    vi.mocked(t.pipeline.stt.transcribe).mockRejectedValue(new Error('secret provider detail'));
    t.lab.enter();
    await t.lab.start('Hallo', true, t.settings, t.create);
    t.preview('Hal');
    await t.lab.stop();
    expect(t.lab.state()).toMatchObject({
      hasAudio: true,
      current: { previews: [{ text: 'Hal' }], error: expect.stringContaining('RAM') },
    });
    expect(JSON.stringify(t.lab.state())).not.toContain('secret provider detail');
    t.save.mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(() => t.lab.save(true)).toThrow('disk full');
    expect(t.lab.state().hasAudio).toBe(true);
    expect(t.lab.state().saved).toBe(false);
    t.lab.discard();
    expect(t.lab.state().current).toBeNull();
  });

  it('cleans up a failed recorder start and never opens a second recording while starting', async () => {
    const t = setup();
    let fail!: (reason: Error) => void;
    vi.mocked(t.pipeline.recorder.start).mockImplementation(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    t.lab.enter();
    const starting = t.lab.start('Hallo', true, t.settings, t.create);
    expect(() => t.lab.discard()).toThrow('stoppen');
    await expect(t.lab.start('Hallo', true, t.settings, t.create)).rejects.toThrow('bereit');
    fail(new Error('mic unavailable'));
    await starting;
    expect(t.pipeline.recorder.cancel).toHaveBeenCalled();
    expect(t.lab.state()).toMatchObject({ phase: 'result', hasAudio: false });
  });

  it('keeps the recorder available and allows another stop after a temporary audio transfer failure', async () => {
    const t = setup();
    vi.mocked(t.pipeline.recorder.stop)
      .mockRejectedValueOnce(new Error('temporary IPC timeout'))
      .mockResolvedValueOnce(clip);
    t.lab.enter();
    await t.lab.start('Hallo', true, t.settings, t.create);
    await t.lab.stop();
    expect(t.lab.state()).toMatchObject({
      phase: 'capture-error',
      hasAudio: false,
      current: { captureFailed: true, error: expect.stringContaining('erneut abrufen') },
    });

    await t.lab.stop();
    expect(t.lab.state()).toMatchObject({
      phase: 'result',
      hasAudio: true,
      current: { captureFailed: false, finalText: 'Bitte prüfen.' },
    });
    expect(t.pipeline.recorder.stop).toHaveBeenCalledTimes(2);
  });

  it('explicitly discards an in-flight RAM-only test during confirmed quit', async () => {
    const t = setup();
    let resolveStart!: () => void;
    vi.mocked(t.pipeline.recorder.start).mockImplementation(
      () => new Promise((resolve) => (resolveStart = resolve)),
    );
    t.lab.enter();
    const starting = t.lab.start('Nicht speichern', true, t.settings, t.create);
    expect(t.lab.hasUnsavedTest).toBe(true);
    t.lab.discardForQuit();
    expect(t.lab.state()).toMatchObject({ enabled: false, phase: 'idle', current: null });
    expect(t.pipeline.recorder.cancel).toHaveBeenCalled();

    resolveStart();
    await starting;
    expect(t.lab.state()).toMatchObject({ enabled: false, phase: 'idle', current: null });
    expect(t.lab.hasUnsavedTest).toBe(false);
  });

  it('stops after the watchdog limit and ignores old preview callbacks after discard', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.lab.enter();
    await t.lab.start('Erster', true, t.settings, t.create);
    const old = t.create.mock.calls[0]![0];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.lab.state().phase).toBe('result');
    expect(t.pipeline.recorder.stop).toHaveBeenCalledTimes(1);
    t.lab.discard();
    await t.lab.start('Zweiter', true, t.settings, t.create);
    old('Verspäteter erster Test');
    expect(t.lab.state().current?.previews).toEqual([]);
    await t.lab.stop();
  });

  it('loads one saved package for review, exports its exact representation and deletes it', async () => {
    const t = setup();
    t.lab.enter();
    await t.lab.start('Hallo', true, t.settings, t.create);
    await t.lab.stop();
    const p = labPackage(t.lab.state().current!, clip);
    const id = p.attempt.id;
    t.lab.discard();
    vi.spyOn(t.store, 'read').mockReturnValue(p);
    const remove = vi.spyOn(t.store, 'delete').mockImplementation(() => {});
    t.lab.load(id);
    expect(t.lab.state()).toMatchObject({ current: p.attempt, hasAudio: true, saved: true });
    const bytes = Buffer.from(p.audio.data, 'base64');
    expect(new Uint8Array(bytes)).toEqual(clip.data);
    t.lab.delete(id);
    expect(remove).toHaveBeenCalledWith(id);
    expect(t.lab.state().saved).toBe(false);
    expect(t.lab.state().hasAudio).toBe(false);
    expect(t.lab.state().current).toBeNull();
  });
});
