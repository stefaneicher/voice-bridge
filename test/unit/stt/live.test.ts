import { describe, expect, it, vi } from 'vitest';
import type { AudioClip, RecorderPort, SpeechToText } from '../../../src/core';
import { LiveTranscription, type LiveSession } from '../../../src/stt/live';

function session(result: Promise<string> = Promise.resolve('live text')): LiveSession & {
  append: ReturnType<typeof vi.fn<(pcm: Uint8Array) => void>>;
  close: ReturnType<typeof vi.fn<() => void>>;
} {
  return {
    append: vi.fn<(pcm: Uint8Array) => void>(),
    finish: vi.fn(() => result),
    close: vi.fn<() => void>(),
  };
}

function setup(open: () => LiveSession | null) {
  const onText = vi.fn();
  const log = vi.fn();
  const live = new LiveTranscription({ open, onText, finishTimeoutMs: () => 1000, log });
  const clip = (): AudioClip => ({
    data: new Uint8Array([1]),
    mimeType: 'audio/wav',
    durationMs: 900,
  });
  const inner: RecorderPort & { stop: ReturnType<typeof vi.fn> } = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => clip()),
    cancel: vi.fn(),
  };
  const fallback: SpeechToText & { transcribe: ReturnType<typeof vi.fn> } = {
    transcribe: vi.fn(async () => ({ text: 'file text' })),
  };
  const refine = vi.fn(async (raw: string) => ({ text: `${raw}!` }));
  return {
    live,
    onText,
    log,
    inner,
    fallback,
    refine,
    rec: live.recorder(inner),
    stt: live.stt(fallback, refine),
  };
}

describe('LiveTranscription', () => {
  it('streams while recording and uses the refined live transcript', async () => {
    const s = session();
    const t = setup(() => s);
    await t.rec.start();
    expect(t.onText).toHaveBeenCalledWith('');
    expect(t.live.active).toBe(true);
    t.live.push(new Uint8Array([7]));
    expect(s.append).toHaveBeenCalledWith(new Uint8Array([7]));
    const clip = await t.rec.stop();
    expect(t.live.active).toBe(false);
    await expect(t.stt.transcribe(clip)).resolves.toEqual({ text: 'live text!' });
    expect(t.fallback.transcribe).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalled();
    // A retry of the same clip goes through file transcription.
    await expect(t.stt.transcribe(clip)).resolves.toEqual({ text: 'file text' });
  });

  it('forwards live text to the overlays', async () => {
    let report!: (t: string) => void;
    const t = setup(() => session());
    const live = new LiveTranscription({
      open: (onText) => {
        report = onText;
        return session();
      },
      onText: t.onText,
      finishTimeoutMs: () => 1000,
    });
    await live.recorder(t.inner).start();
    report('Hallo');
    expect(t.onText).toHaveBeenLastCalledWith('Hallo');
  });

  it('falls back to file transcription when the live session fails', async () => {
    const s = session(Promise.reject(new Error('boom')));
    const t = setup(() => s);
    await t.rec.start();
    const clip = await t.rec.stop();
    await expect(t.stt.transcribe(clip)).resolves.toEqual({ text: 'file text' });
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining('live: failed'));
    expect(s.close).toHaveBeenCalled();
  });

  it('falls back when the live transcript is empty', async () => {
    const t = setup(() => session(Promise.resolve('  ')));
    await t.rec.start();
    const clip = await t.rec.stop();
    await expect(t.stt.transcribe(clip)).resolves.toEqual({ text: 'file text' });
    expect(t.refine).not.toHaveBeenCalled();
  });

  it('rethrows when the user aborts and skips the fallback', async () => {
    const s = session(new Promise<string>(() => {}));
    const t = setup(() => s);
    await t.rec.start();
    const clip = await t.rec.stop();
    const ac = new AbortController();
    const done = t.stt.transcribe(clip, { signal: ac.signal });
    ac.abort(new Error('cancelled'));
    await expect(done).rejects.toThrow('cancelled');
    expect(t.fallback.transcribe).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalled();
  });

  it('rejects immediately for an already aborted signal', async () => {
    const t = setup(() => session());
    await t.rec.start();
    const clip = await t.rec.stop();
    const ac = new AbortController();
    ac.abort(new Error('gone'));
    await expect(t.stt.transcribe(clip, { signal: ac.signal })).rejects.toThrow('gone');
  });

  it('uses file transcription when live is off', async () => {
    const t = setup(() => null);
    await t.rec.start();
    expect(t.live.active).toBe(false);
    t.live.push(new Uint8Array([1]));
    const clip = await t.rec.stop();
    await expect(t.stt.transcribe(clip)).resolves.toEqual({ text: 'file text' });
  });

  it('survives a session that cannot be opened', async () => {
    const t = setup(() => {
      throw new Error('no ws');
    });
    await t.rec.start();
    expect(t.live.active).toBe(false);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining('could not start'));
  });

  it('closes the session on cancel and on recorder errors', async () => {
    const s1 = session();
    const t = setup(() => s1);
    await t.rec.start();
    t.rec.cancel();
    expect(s1.close).toHaveBeenCalled();
    expect(t.inner.cancel).toHaveBeenCalled();

    const s2 = session();
    const t2 = setup(() => s2);
    t2.inner.stop.mockRejectedValueOnce(new Error('no audio'));
    await t2.rec.start();
    await expect(t2.rec.stop()).rejects.toThrow('no audio');
    expect(s2.close).toHaveBeenCalled();

    const s3 = session();
    const t3 = setup(() => s3);
    (t3.inner.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('no mic'));
    await expect(t3.rec.start()).rejects.toThrow('no mic');
    expect(s3.close).toHaveBeenCalled();
    expect(t3.live.active).toBe(false);
  });
});
