import WebSocket from 'ws';
import type { LiveDelay } from '../shared/live-delay';

/** Sample rate the realtime transcription API expects for `audio/pcm`. */
export const REALTIME_SAMPLE_RATE = 24_000;

export interface RealtimeConfig {
  model: string;
  language: string;
  prompt: string;
  keywords: string[];
  delay: LiveDelay;
}

export interface SocketHandlers {
  open(): void;
  message(data: string): void;
  fail(err: Error): void;
}

export interface RealtimeSocket {
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (
  url: string,
  headers: Record<string, string>,
  handlers: SocketHandlers,
) => RealtimeSocket;

export const wsSocket: SocketFactory = (url, headers, h) => {
  const ws = new WebSocket(url, { headers });
  ws.on('open', () => h.open());
  ws.on('message', (data: WebSocket.RawData) => {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString()
      : Buffer.from(data as ArrayBuffer).toString();
    h.message(text);
  });
  ws.on('error', (err) => h.fail(err));
  ws.on('close', (code) => h.fail(new Error(`Verbindung geschlossen (${code})`)));
  return {
    send: (data) => ws.send(data),
    close: () => {
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
        ws.terminate();
    },
  };
};

export interface RealtimeOptions {
  baseUrl: string;
  apiKey: string;
  config: RealtimeConfig;
  onText: (text: string) => void;
  connect?: SocketFactory;
  log?: (msg: string) => void;
}

/**
 * One live transcription turn over the OpenAI realtime API (ADR-016). Audio is appended while the
 * user speaks; deltas are reported as accumulated text. `finish()` commits the turn and resolves
 * with the final transcript. Audio stays in memory and is only queued until the socket is open.
 */
export class RealtimeTranscription {
  private readonly socket: RealtimeSocket;
  private open = false;
  private closed = false;
  private failure: Error | null = null;
  private readonly queue: string[] = [];
  private text = '';
  private final: string | null = null;
  private settle: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  constructor(private readonly o: RealtimeOptions) {
    const url = `${o.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime?intent=transcription`;
    const connect = o.connect ?? wsSocket;
    this.socket = connect(
      url,
      { authorization: `Bearer ${o.apiKey}` },
      {
        open: () => this.onOpen(),
        message: (data) => this.onMessage(data),
        fail: (err) => this.fail(err),
      },
    );
  }

  append(pcm: Uint8Array): void {
    if (pcm.length === 0) return;
    this.send({ type: 'input_audio_buffer.append', audio: Buffer.from(pcm).toString('base64') });
  }

  /** Commits the turn and waits for the final transcript. Rejects on error or timeout. */
  finish(timeoutMs: number): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.final !== null) return Promise.resolve(this.final);
    this.send({ type: 'input_audio_buffer.commit' });
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error(`kein Ergebnis nach ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.settle = {
        resolve: (t) => {
          clearTimeout(timer);
          resolve(t);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.length = 0;
    this.socket.close();
  }

  private onOpen(): void {
    this.open = true;
    const c = this.o.config;
    const keywords = c.keywords.map((k) => k.replace(/[<>\r\n]/g, ' ').trim()).filter(Boolean);
    this.socket.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE },
              transcription: {
                model: c.model,
                languages: [c.language],
                delay: c.delay,
                ...(c.prompt ? { prompt: c.prompt } : {}),
                ...(keywords.length ? { keywords } : {}),
              },
              turn_detection: null,
            },
          },
        },
      }),
    );
    for (const msg of this.queue.splice(0)) this.socket.send(msg);
  }

  private onMessage(data: string): void {
    let event: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try {
      event = JSON.parse(data) as typeof event;
    } catch {
      return;
    }
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.delta':
        if (event.delta) {
          this.text += event.delta;
          this.o.onText(this.text);
        }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.final = event.transcript ?? this.text;
        this.o.onText(this.final);
        this.settle?.resolve(this.final);
        this.settle = null;
        break;
      case 'conversation.item.input_audio_transcription.failed':
        this.fail(new Error(event.error?.message ?? 'Transkription fehlgeschlagen'));
        break;
      case 'error':
        this.fail(new Error(event.error?.message ?? 'Fehler der Realtime-API'));
        break;
    }
  }

  private send(event: object): void {
    if (this.closed || this.failure) return;
    const msg = JSON.stringify(event);
    if (this.open) this.socket.send(msg);
    else this.queue.push(msg);
  }

  private fail(err: Error): void {
    if (this.failure || this.final !== null) return;
    if (this.closed && !this.settle) return;
    this.failure = err;
    this.o.log?.(`live: ${err.message}`);
    this.settle?.reject(err);
    this.settle = null;
    this.close();
  }
}
