import { randomUUID } from 'node:crypto';
import type { AudioClip, RecorderPort, SpeechToText } from '../core';
import type { LabAttempt, LabReview, LabSettings, LabState } from '../shared/speech-lab';
import type { SpeechLabStore } from './speech-lab-store';

export interface LabPipeline {
  recorder: RecorderPort;
  stt: SpeechToText;
}

/** Isolated diagnostic flow. No agent, inserter, history or telemetry port exists here. */
export class SpeechLab {
  private enabled = false;
  private phase: LabState['phase'] = 'idle';
  private current: LabAttempt | null = null;
  private clip: AudioClip | null = null;
  private saved = false;
  private pipeline: LabPipeline | null = null;
  private started = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private transcription: AbortController | null = null;
  private stored: ReturnType<SpeechLabStore['list']>;

  constructor(
    private readonly store: SpeechLabStore,
    private readonly changed: () => void,
    private readonly now = () => performance.now(),
  ) {
    this.stored = store.list();
  }

  get active(): boolean {
    return this.enabled;
  }

  get busy(): boolean {
    return ['starting', 'recording', 'finishing'].includes(this.phase);
  }

  get hasUnsavedTest(): boolean {
    return this.enabled && this.current !== null && !this.saved;
  }

  state(): LabState {
    return {
      enabled: this.enabled,
      phase: this.phase,
      current: this.current,
      hasAudio: this.clip !== null,
      saved: this.saved,
      entries: this.stored.entries,
      storageWarning: this.stored.warning,
    };
  }

  enter(): void {
    this.stored = this.store.list();
    this.enabled = true;
    this.changed();
  }

  exit(): void {
    if (this.busy || this.current) {
      throw new Error('Aufnahme zuerst stoppen und den aktuellen Test ausdrücklich verwerfen.');
    }
    this.enabled = false;
    this.changed();
  }

  async start(
    expected: unknown,
    consent: unknown,
    settings: LabSettings,
    create: (preview: (text: string) => void, event: (name: string) => void) => LabPipeline,
  ): Promise<void> {
    if (!this.enabled || this.busy || this.current) throw new Error('Testlabor ist nicht bereit.');
    if (consent !== true) throw new Error('Bitte die Cloud-Übertragung zuerst bestätigen.');
    if (typeof expected !== 'string' || !expected.trim() || expected.length > 2000) {
      throw new Error('Bitte einen Testsatz mit höchstens 2000 Zeichen eingeben.');
    }
    this.started = this.now();
    this.current = {
      schemaVersion: 1,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      expected: expected.trim(),
      settings,
      events: [],
      previews: [],
      finalText: '',
      review: 'unreviewed',
      correction: '',
    };
    this.phase = 'starting';
    this.saved = false;
    this.event('start-requested');
    this.changed();
    try {
      const id = this.current.id;
      this.pipeline = create(
        (text) => {
          if (this.current?.id === id) this.preview(text);
        },
        (name) => {
          if (this.current?.id === id && this.busy) this.event(name);
        },
      );
      await this.pipeline.recorder.start();
      if (this.current?.id !== id) return;
      this.phase = 'recording';
      this.event('recording');
      this.timer = setTimeout(() => void this.stop(), 120_000);
    } catch {
      if (!this.current) return;
      this.pipeline?.recorder.cancel();
      this.phase = 'result';
      this.current.error = 'Mikrofon oder Live-Verbindung konnte nicht gestartet werden.';
      this.event('error');
    }
    this.changed();
  }

  async stop(): Promise<void> {
    if (
      (this.phase !== 'recording' && this.phase !== 'capture-error') ||
      !this.current ||
      !this.pipeline
    ) {
      return;
    }
    clearTimeout(this.timer);
    const id = this.current.id;
    if (this.phase === 'recording') {
      this.current.releasedAtMs = this.elapsed();
      this.event('release');
    } else {
      delete this.current.error;
      this.event('retry-audio-transfer');
    }
    this.phase = 'finishing';
    this.changed();
    try {
      const clip = await this.pipeline.recorder.stop();
      if (this.current?.id !== id) return;
      this.clip = clip;
      this.current.captureFailed = false;
      this.current.durationMs = this.clip.durationMs;
      this.event('audio-ready');
    } catch {
      if (this.current?.id !== id) return;
      this.phase = 'capture-error';
      this.current.captureFailed = true;
      this.current.error =
        'Audio konnte noch nicht vom Recorder abgeholt werden. Es bleibt dort im Arbeitsspeicher; bitte erneut abrufen.';
      this.event('audio-transfer-failed');
      this.changed();
      return;
    }
    const controller = new AbortController();
    this.transcription = controller;
    try {
      const result = await this.pipeline.stt.transcribe(this.clip, { signal: controller.signal });
      if (this.current?.id !== id) return;
      this.current.finalText = result.text;
      this.current.rawText = result.raw;
      this.current.finalAtMs = this.elapsed();
      this.event('final');
    } catch {
      if (this.current?.id !== id) return;
      this.current.error =
        'Erkennung fehlgeschlagen. Das abgeholte Audio und Vorschauen bleiben im RAM.';
      this.event('error');
    } finally {
      if (this.transcription === controller) this.transcription = null;
    }
    if (this.current?.id !== id) return;
    this.phase = 'result';
    this.changed();
  }

  preview(text: string): void {
    if (!this.current || !this.busy || text.length > 16000) return;
    const previews = this.current.previews;
    if (previews.length >= 2000 || previews.at(-1)?.text === text) return;
    previews.push({ text, atMs: this.elapsed() });
    this.changed();
  }

  review(review: unknown, correction: unknown): void {
    if (
      this.busy ||
      !this.current ||
      typeof review !== 'string' ||
      !['unreviewed', 'correct', 'incorrect'].includes(review) ||
      typeof correction !== 'string' ||
      correction.length > 16000
    ) {
      throw new Error('Ungültige Bewertung.');
    }
    this.current.review = review as LabReview;
    this.current.correction = correction;
    // Review changes stay in RAM until the explicit save action.
    this.saved = false;
    this.changed();
  }

  save(consent: unknown): void {
    if (this.busy || !this.current || !this.clip) throw new Error('Kein Audio zum Speichern.');
    if (consent !== true)
      throw new Error('Lokales Speichern braucht Ihre ausdrückliche Zustimmung.');
    this.store.save(this.current, this.clip, true);
    this.stored = this.store.list();
    this.saved = true;
    this.changed();
  }

  discard(): void {
    if (this.busy) throw new Error('Aufnahme zuerst stoppen.');
    this.pipeline?.recorder.cancel();
    this.current = null;
    this.clip = null;
    this.pipeline = null;
    this.saved = false;
    this.phase = 'idle';
    this.changed();
  }

  discardForQuit(): void {
    clearTimeout(this.timer);
    this.transcription?.abort();
    this.transcription = null;
    this.pipeline?.recorder.cancel();
    this.enabled = false;
    this.current = null;
    this.clip = null;
    this.pipeline = null;
    this.saved = false;
    this.phase = 'idle';
    this.changed();
  }

  load(id: string): void {
    if (!this.enabled || this.busy || this.current)
      throw new Error('Aktuellen Test zuerst verwerfen.');
    const p = this.store.read(id);
    if (!p) throw new Error('Testdatei fehlt oder ist ungültig.');
    this.current = p.attempt;
    this.clip = {
      data: new Uint8Array(Buffer.from(p.audio.data, 'base64')),
      mimeType: 'audio/wav',
      durationMs: p.attempt.durationMs ?? 0,
    };
    this.saved = true;
    this.phase = 'result';
    this.changed();
  }

  delete(id: string): void {
    if (this.busy) throw new Error('Aufnahme zuerst stoppen.');
    this.store.delete(id);
    this.stored = this.store.list();
    if (this.current?.id === id) {
      this.discard();
      return;
    }
    this.changed();
  }

  private elapsed(): number {
    return Math.max(0, this.now() - this.started);
  }

  private event(name: string): void {
    this.current?.events.push({ name, atMs: this.elapsed() });
  }
}
