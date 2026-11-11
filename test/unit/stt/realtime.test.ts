import { describe, expect, it, vi } from 'vitest';
import {
  RealtimeTranscription,
  type SocketFactory,
  type SocketHandlers,
} from '../../../src/stt/realtime';

function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  let handlers!: SocketHandlers;
  let url = '';
  let headers: Record<string, string> = {};
  const close = vi.fn();
  const connect: SocketFactory = (u, h, hs) => {
    url = u;
    headers = h;
    handlers = hs;
    return { send: (d) => sent.push(JSON.parse(d) as Record<string, unknown>), close };
  };
  return {
    connect,
    sent,
    close,
    get url() {
      return url;
    },
    get headers() {
      return headers;
    },
    open: () => handlers.open(),
    emit: (e: object) => handlers.message(JSON.stringify(e)),
    fail: (err: Error) => handlers.fail(err),
  };
}

const config = {
  model: 'gpt-live-transcribe',
  language: 'de',
  prompt: 'Gesprochen wird Berndeutsch.',
  keywords: ['Copilot', ' ', 'Ci<trix>'],
  delay: 'low' as const,
};

function create(onText = vi.fn(), log = vi.fn()) {
  const s = fakeSocket();
  const rt = new RealtimeTranscription({
    baseUrl: 'https://api.openai.com/v1/',
    apiKey: 'k',
    config,
    onText,
    connect: s.connect,
    log,
  });
  return { s, rt, onText, log };
}

describe('RealtimeTranscription', () => {
  it('connects with auth and configures a transcription session on open', () => {
    const { s } = create();
    expect(s.url).toBe('wss://api.openai.com/v1/realtime?intent=transcription');
    expect(s.headers.authorization).toBe('Bearer k');
    s.open();
    expect(s.sent[0]).toEqual({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: {
              model: 'gpt-live-transcribe',
              languages: ['de'],
              delay: 'low',
              prompt: 'Gesprochen wird Berndeutsch.',
              keywords: ['Copilot', 'Ci trix'],
            },
            turn_detection: null,
          },
        },
      },
    });
  });

  it('queues audio until the socket is open, then sends it in order', () => {
    const { s, rt } = create();
    rt.append(new Uint8Array([1, 2]));
    rt.append(new Uint8Array());
    expect(s.sent).toHaveLength(0);
    s.open();
    expect(s.sent.map((m) => m.type)).toEqual(['session.update', 'input_audio_buffer.append']);
    expect(s.sent[1]!.audio).toBe(Buffer.from([1, 2]).toString('base64'));
  });

  it('reports accumulated deltas and resolves finish with the final transcript', async () => {
    const { s, rt, onText } = create();
    s.open();
    s.emit({ type: 'conversation.item.input_audio_transcription.delta', delta: 'Hallo' });
    s.emit({ type: 'conversation.item.input_audio_transcription.delta', delta: ' Welt' });
    expect(onText).toHaveBeenLastCalledWith('Hallo Welt');
    const done = rt.finish(1000);
    expect(s.sent.at(-1)!.type).toBe('input_audio_buffer.commit');
    s.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hallo Welt.',
    });
    await expect(done).resolves.toBe('Hallo Welt.');
    expect(onText).toHaveBeenLastCalledWith('Hallo Welt.');
    await expect(rt.finish(1000)).resolves.toBe('Hallo Welt.');
  });

  it('ignores garbage and unknown events', () => {
    const { s, onText } = create();
    s.open();
    (s as unknown as { emit: (e: object) => void }).emit({ type: 'session.updated' });
    expect(onText).not.toHaveBeenCalled();
  });

  it('rejects finish on an API error and closes the socket', async () => {
    const { s, rt, log } = create();
    s.open();
    const done = rt.finish(1000);
    s.emit({ type: 'error', error: { message: 'bad model' } });
    await expect(done).rejects.toThrow('bad model');
    expect(s.close).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('live: bad model');
    await expect(rt.finish(1000)).rejects.toThrow('bad model');
  });

  it('rejects on a failed transcription event', async () => {
    const { s, rt } = create();
    s.open();
    const done = rt.finish(1000);
    s.emit({ type: 'conversation.item.input_audio_transcription.failed' });
    await expect(done).rejects.toThrow('Transkription fehlgeschlagen');
  });

  it('rejects when no result arrives in time', async () => {
    vi.useFakeTimers();
    try {
      const { s, rt } = create();
      s.open();
      const done = rt.finish(500);
      const check = expect(done).rejects.toThrow('kein Ergebnis nach 500 ms');
      await vi.advanceTimersByTimeAsync(500);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays quiet when the socket closes after we closed it ourselves', () => {
    const { s, rt, log } = create();
    s.open();
    rt.close();
    rt.close();
    s.fail(new Error('Verbindung geschlossen (1006)'));
    expect(log).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledTimes(1);
    rt.append(new Uint8Array([1]));
    expect(s.sent).toHaveLength(1);
  });
});
