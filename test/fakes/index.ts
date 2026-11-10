import type {
  AgentAdapter,
  AudioClip,
  Clock,
  DeliveryResult,
  InputEvent,
  InputPort,
  InsertResult,
  RecorderPort,
  SessionInfo,
  SpeechToText,
  TextInserter,
  TimerHandle,
  Transcript,
} from '../../src/core';
import type { ClipboardPort, KeySender } from '../../src/output/inserter';

export class FakeClock implements Clock {
  private t = 0;
  private timers: { at: number; cb: () => void; cancelled: boolean }[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(cb: () => void, ms: number): TimerHandle {
    const timer = { at: this.t + ms, cb, cancelled: false };
    this.timers.push(timer);
    return { cancel: () => (timer.cancelled = true) };
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const next = this.timers
        .filter((x) => !x.cancelled && x.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.t = next.at;
      next.cancelled = true;
      next.cb();
    }
    this.t = end;
  }
}

export class FakeInput implements InputPort {
  private cb: ((e: InputEvent) => void) | null = null;
  wheelCapture = false;
  cancelCapture = false;

  onEvent(cb: (e: InputEvent) => void) {
    this.cb = cb;
    return () => (this.cb = null);
  }

  setWheelCapture(enabled: boolean): void {
    this.wheelCapture = enabled;
  }

  setCancelCapture(enabled: boolean): void {
    this.cancelCapture = enabled;
  }

  emit(e: InputEvent): void {
    this.cb?.(e);
  }
}

export class FakeRecorder implements RecorderPort {
  recording = false;
  starts = 0;
  cancels = 0;
  /** Bytes "recorded" so far; grows while recording. */
  buffer: number[] = [];
  failStart: Error | null = null;

  async start(): Promise<void> {
    if (this.failStart) throw this.failStart;
    this.starts++;
    this.recording = true;
    this.buffer = [];
  }

  /** Simulates audio frames arriving. */
  feed(frames: number): void {
    if (this.recording) for (let i = 0; i < frames; i++) this.buffer.push(i & 0xff);
  }

  async stop(): Promise<AudioClip> {
    this.recording = false;
    return { data: Uint8Array.from(this.buffer), mimeType: 'audio/wav', durationMs: 1000 };
  }

  cancel(): void {
    this.cancels++;
    this.recording = false;
    this.buffer = [];
  }
}

export class FakeStt implements SpeechToText {
  calls: AudioClip[] = [];
  results: (Transcript | Error)[] = [];
  signals: (AbortSignal | undefined)[] = [];
  /** When set, transcribe() waits for this promise before answering. */
  gate: Promise<void> | null = null;

  async transcribe(clip: AudioClip, options?: { signal?: AbortSignal }): Promise<Transcript> {
    this.calls.push(clip);
    this.signals.push(options?.signal);
    if (this.gate) await this.gate;
    const next = this.results.shift() ?? { text: 'Hallo Welt' };
    if (next instanceof Error) throw next;
    return next;
  }
}

export class FakeAdapter implements AgentAdapter {
  sent: { sessionId: string; text: string }[] = [];
  private listeners = new Set<(s: SessionInfo[]) => void>();
  nextResult: DeliveryResult | null = null;

  constructor(
    public sessions: SessionInfo[],
    readonly id = 'fake',
  ) {}

  async listSessions(): Promise<SessionInfo[]> {
    return [...this.sessions];
  }

  onChange(cb: (s: SessionInfo[]) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setSessions(sessions: SessionInfo[]): void {
    this.sessions = sessions;
    for (const l of this.listeners) l([...sessions]);
  }

  remove(id: string): void {
    this.setSessions(this.sessions.filter((s) => s.id !== id));
  }

  async send(sessionId: string, text: string): Promise<DeliveryResult> {
    if (this.nextResult) {
      const r = this.nextResult;
      this.nextResult = null;
      return r;
    }
    if (!this.sessions.some((s) => s.id === sessionId)) return { ok: false, reason: 'gone' };
    this.sent.push({ sessionId, text });
    return { ok: true };
  }
}

export class FakeInserter implements TextInserter {
  inserted: string[] = [];
  nextResult: InsertResult = { ok: true };

  async insert(text: string): Promise<InsertResult> {
    this.inserted.push(text);
    return this.nextResult;
  }
}

export class FakeClipboard implements ClipboardPort {
  constructor(public text = '') {}

  async snapshot() {
    return this.text;
  }

  async restore(snapshot: unknown): Promise<void> {
    this.text = snapshot as string;
  }

  async readText(): Promise<string> {
    return this.text;
  }

  async writeText(text: string): Promise<void> {
    this.text = text;
  }
}

/** Records every key the inserter sends. */
export class FakeKeys implements KeySender {
  sentKeys: string[] = [];
  typed: string[] = [];
  pasteError: Error | null = null;

  constructor(private readonly clipboard: FakeClipboard) {}

  /** What the focused text field received. */
  field = '';

  async sendPaste(): Promise<void> {
    if (this.pasteError) throw this.pasteError;
    this.sentKeys.push('Ctrl+V');
    this.field += this.clipboard.text;
  }

  async typeText(text: string): Promise<void> {
    this.typed.push(text);
    this.field += text;
  }
}

export function session(n: number, extra: Partial<SessionInfo> = {}): SessionInfo {
  return { id: `s${n}`, adapterId: 'fake', name: `session-${n}`, state: 'idle', ...extra };
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}
