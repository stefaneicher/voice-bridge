import type { AudioClip, RecorderPort, SpeechToText, Transcript } from '../core';

/** One running live transcription (see RealtimeTranscription). */
export interface LiveSession {
  append(pcm: Uint8Array): void;
  finish(timeoutMs: number): Promise<string>;
  close(): void;
}

export interface LiveTranscriptionOptions {
  /** Opens a session for the next recording, or null when live transcription is off/unavailable. */
  open: (onText: (text: string) => void) => LiveSession | null;
  /** Live text for the overlays; '' at the start of every recording. */
  onText: (text: string) => void;
  finishTimeoutMs: () => number;
  log?: (msg: string) => void;
}

/**
 * Streams the local microphone to a realtime transcription while recording (ADR-016). Wraps the
 * recorder (to open and feed a session) and the speech-to-text port (to use the live result at
 * release). Any failure falls back to the regular file transcription of the same clip, so no
 * recording is lost. The controller in `core/` does not know about any of this.
 */
export class LiveTranscription {
  private current: LiveSession | null = null;
  private readonly byClip = new WeakMap<AudioClip, LiveSession>();

  constructor(private readonly o: LiveTranscriptionOptions) {}

  /** True while a recording streams into a live session. */
  get active(): boolean {
    return this.current !== null;
  }

  push(pcm: Uint8Array): void {
    this.current?.append(pcm);
  }

  recorder(inner: RecorderPort): RecorderPort {
    return {
      start: async () => {
        this.begin();
        try {
          await inner.start();
        } catch (err) {
          this.drop();
          throw err;
        }
      },
      stop: async () => {
        const session = this.current;
        this.current = null;
        let clip: AudioClip;
        try {
          clip = await inner.stop();
        } catch (err) {
          session?.close();
          throw err;
        }
        if (session) this.byClip.set(clip, session);
        return clip;
      },
      cancel: () => {
        this.drop();
        inner.cancel();
      },
    };
  }

  /**
   * Uses the live transcript for clips recorded with a session; everything else (phone audio,
   * retries) and every live failure goes to `fallback`. `refine` applies the usual post-processing.
   */
  stt(
    fallback: SpeechToText,
    refine: (raw: string, signal?: AbortSignal) => Promise<Transcript>,
  ): SpeechToText {
    return {
      transcribe: async (clip, options = {}) => {
        const session = this.byClip.get(clip);
        if (!session) return fallback.transcribe(clip, options);
        this.byClip.delete(clip);
        try {
          const raw = (
            await abortable(session.finish(this.o.finishTimeoutMs()), options.signal)
          ).trim();
          if (raw) return await refine(raw, options.signal);
          this.o.log?.('live: empty transcript, using file transcription');
        } catch (err) {
          if (options.signal?.aborted) throw err;
          this.o.log?.(`live: failed, using file transcription (${String(err)})`);
        } finally {
          session.close();
        }
        return fallback.transcribe(clip, options);
      },
    };
  }

  private begin(): void {
    this.drop();
    this.o.onText('');
    try {
      this.current = this.o.open((text) => this.o.onText(text));
    } catch (err) {
      this.o.log?.(`live: could not start (${String(err)})`);
      this.current = null;
    }
  }

  private drop(): void {
    this.current?.close();
    this.current = null;
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
