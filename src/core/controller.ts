import type {
  Clock,
  InputPort,
  RecorderPort,
  SpeechToText,
  TextInserter,
  TimerHandle,
} from './ports';
import type { AgentRegistry } from './registry';
import { errorMessage } from './registry';
import { initialSelection, mergeSessions, moveSelection } from './selection';
import type {
  AudioClip,
  Failure,
  FailureAction,
  FailureKind,
  HotkeyAction,
  InputEvent,
  SessionInfo,
  SessionView,
} from './types';

export type Phase =
  | { name: 'idle' }
  | { name: 'recording'; mode: 'dictate'; startedAt: number }
  | {
      name: 'recording';
      mode: 'agent';
      startedAt: number;
      sessions: SessionView[];
      selectedId: string | null;
      loading: boolean;
    }
  | { name: 'transcribing'; mode: HotkeyAction; target?: SessionInfo }
  | { name: 'inserting'; text: string }
  | { name: 'delivering'; text: string; target: SessionInfo }
  | {
      name: 'done';
      mode: HotkeyAction;
      text: string;
      rawText?: string;
      target?: SessionInfo;
      words: number;
      elapsedMs: number;
    };

export interface ControllerState {
  phase: Phase;
  failures: Failure[];
  paused: boolean;
  lastSessionId: string | null;
}

export interface ControllerOptions {
  input: InputPort;
  recorder: RecorderPort;
  stt: SpeechToText;
  inserter: TextInserter;
  agents: AgentRegistry;
  clock: Clock;
  /** Shorter holds count as accidental and are dropped silently. */
  minHoldMs?: number;
  /** Watchdog: a missed release ends the recording after this time. */
  maxRecordingMs?: number;
  /** Wheel events closer together than this are ignored. */
  wheelDebounceMs?: number;
  lastSessionId?: string | null;
}

/** Result of a run that reached transcription. Kept in memory only. */
interface Job {
  mode: HotkeyAction;
  audio: AudioClip;
  target?: SessionInfo;
  /** For agent runs: the session ID fixed at release time (may be missing → no-sessions). */
  targetId: string | null;
  releasedAt: number;
}

/**
 * The push-to-talk state machine. Pure logic: all I/O goes through the ports.
 * Rules: only the release of the held key ends a recording; the agent target is fixed by ID at
 * release; a vanished target is an error, never a redirect; failures keep text and audio.
 */
export class SessionController {
  private readonly o: Required<Omit<ControllerOptions, 'lastSessionId'>>;
  private state: ControllerState;
  private readonly listeners = new Set<(s: ControllerState) => void>();
  private run = 0;
  private recorderStart: Promise<boolean> | null = null;
  private watchdog: TimerHandle | null = null;
  private unsubscribeSessions: (() => void) | null = null;
  private lastWheelAt = Number.NEGATIVE_INFINITY;
  private failureSeq = 0;
  private readonly unsubscribeInput: () => void;

  constructor(options: ControllerOptions) {
    this.o = {
      minHoldMs: 300,
      maxRecordingMs: 120_000,
      wheelDebounceMs: 120,
      ...options,
    };
    this.state = {
      phase: { name: 'idle' },
      failures: [],
      paused: false,
      lastSessionId: options.lastSessionId ?? null,
    };
    this.unsubscribeInput = this.o.input.onEvent((e) => this.handleInput(e));
  }

  getState(): ControllerState {
    return this.state;
  }

  subscribe(cb: (s: ControllerState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.unsubscribeInput();
    this.endRecordingSideEffects();
    this.listeners.clear();
  }

  /** Applies changed timing settings without losing open failures. */
  configure(
    options: Partial<Pick<ControllerOptions, 'minHoldMs' | 'maxRecordingMs' | 'wheelDebounceMs'>>,
  ): void {
    Object.assign(this.o, options);
  }

  setPaused(paused: boolean): void {
    if (paused && this.state.phase.name === 'recording') this.abortRecording();
    this.update({ paused });
  }

  handleInput(event: InputEvent): void {
    switch (event.type) {
      case 'down':
        this.onDown(event.action);
        break;
      case 'up':
        this.onUp(event.action);
        break;
      case 'wheel':
        this.onWheel(event.delta);
        break;
    }
  }

  /** Click on a popup row. Changes the target only; the recording continues. */
  selectSession(sessionId: string): void {
    const phase = this.state.phase;
    if (phase.name !== 'recording' || phase.mode !== 'agent') return;
    const view = phase.sessions.find((s) => s.id === sessionId);
    if (!view || view.gone) return;
    this.setPhase({ ...phase, selectedId: sessionId });
  }

  async resolveFailure(failureId: string, action: FailureAction): Promise<void> {
    const failure = this.state.failures.find((f) => f.id === failureId);
    if (!failure) return;

    if (action.type === 'discard') {
      this.removeFailure(failureId);
      return;
    }

    if (action.type === 'retry') {
      if (failure.kind === 'stt' && failure.audio) {
        this.removeFailure(failureId);
        await this.process({
          mode: failure.mode,
          audio: failure.audio,
          target: failure.target,
          targetId: failure.target?.id ?? null,
          releasedAt: this.o.clock.now(),
        });
      } else if (failure.kind === 'delivery' && failure.text !== undefined && failure.target) {
        this.removeFailure(failureId);
        await this.deliver(failure.text, failure.rawText, failure.target, this.o.clock.now());
      }
      return;
    }

    // send-to: the user explicitly picked another session.
    if (failure.text === undefined) return;
    const target = await this.o.agents.find(action.sessionId);
    if (!target) {
      this.replaceFailure(failureId, {
        ...failure,
        kind: 'session-gone',
        message: `Die gewählte Session ist nicht mehr da. Der Text ist noch erhalten.`,
      });
      return;
    }
    this.removeFailure(failureId);
    await this.deliver(failure.text, failure.rawText, target, this.o.clock.now());
  }

  // ---------------------------------------------------------------- input

  private onDown(action: HotkeyAction): void {
    if (this.state.paused) return;
    const name = this.state.phase.name;
    if (name !== 'idle' && name !== 'done') return;

    const runId = ++this.run;
    const startedAt = this.o.clock.now();
    this.recorderStart = this.o.recorder.start().then(
      () => true,
      (err: unknown) => {
        if (this.run === runId) {
          this.endRecordingSideEffects();
          this.setPhase({ name: 'idle' });
          this.addFailure({
            kind: 'recorder',
            mode: action,
            message: `Mikrofon konnte nicht gestartet werden: ${errorMessage(err)}`,
          });
        }
        return false;
      },
    );
    this.watchdog = this.o.clock.setTimeout(() => this.onUp(action), this.o.maxRecordingMs);

    if (action === 'dictate') {
      this.setPhase({ name: 'recording', mode: 'dictate', startedAt });
      return;
    }

    this.o.input.setWheelCapture(true);
    this.lastWheelAt = Number.NEGATIVE_INFINITY;
    this.setPhase({
      name: 'recording',
      mode: 'agent',
      startedAt,
      sessions: [],
      selectedId: null,
      loading: true,
    });
    this.unsubscribeSessions = this.o.agents.onChange((fresh) =>
      this.onSessionsChanged(runId, fresh),
    );
    void this.o.agents.listSessions().then((fresh) => {
      const phase = this.state.phase;
      if (this.run !== runId || phase.name !== 'recording' || phase.mode !== 'agent') return;
      if (!phase.loading) return this.onSessionsChanged(runId, fresh);
      this.setPhase({
        ...phase,
        loading: false,
        sessions: fresh.map((s) => ({ ...s, gone: false })),
        selectedId: phase.selectedId ?? initialSelection(fresh, this.state.lastSessionId),
      });
    });
  }

  private onSessionsChanged(runId: number, fresh: SessionInfo[]): void {
    const phase = this.state.phase;
    if (this.run !== runId || phase.name !== 'recording' || phase.mode !== 'agent') return;
    const sessions = mergeSessions(phase.sessions, fresh, phase.selectedId);
    // Only an empty selection may be filled automatically; a chosen one is never replaced.
    const selectedId = phase.selectedId ?? initialSelection(fresh, this.state.lastSessionId);
    this.setPhase({ ...phase, loading: false, sessions, selectedId });
  }

  private onWheel(delta: 1 | -1): void {
    const phase = this.state.phase;
    if (phase.name !== 'recording' || phase.mode !== 'agent') return;
    const now = this.o.clock.now();
    if (now - this.lastWheelAt < this.o.wheelDebounceMs) return;
    this.lastWheelAt = now;
    this.setPhase({ ...phase, selectedId: moveSelection(phase.sessions, phase.selectedId, delta) });
  }

  private onUp(action: HotkeyAction): void {
    const phase = this.state.phase;
    if (phase.name !== 'recording' || phase.mode !== action) return;
    const runId = this.run;
    const releasedAt = this.o.clock.now();
    const heldMs = releasedAt - phase.startedAt;
    const target =
      phase.mode === 'agent' ? phase.sessions.find((s) => s.id === phase.selectedId) : undefined;
    const targetId = phase.mode === 'agent' ? phase.selectedId : null;
    const started = this.recorderStart ?? Promise.resolve(false);
    this.endRecordingSideEffects();

    if (heldMs < this.o.minHoldMs) {
      this.o.recorder.cancel();
      this.setPhase({ name: 'idle' });
      return;
    }

    const fixedTarget = target ? stripView(target) : undefined;
    this.setPhase({ name: 'transcribing', mode: action, target: fixedTarget });

    void started.then(async (ok) => {
      if (!ok || this.run !== runId) return;
      let audio: AudioClip;
      try {
        audio = await this.o.recorder.stop();
      } catch (err) {
        this.setPhase({ name: 'idle' });
        this.addFailure({
          kind: 'recorder',
          mode: action,
          message: `Aufnahme fehlgeschlagen: ${errorMessage(err)}`,
        });
        return;
      }
      await this.process({ mode: action, audio, target: fixedTarget, targetId, releasedAt });
    });
  }

  // ---------------------------------------------------------------- pipeline

  private async process(job: Job): Promise<void> {
    this.setPhase({ name: 'transcribing', mode: job.mode, target: job.target });
    let text: string;
    let rawText: string | undefined;
    try {
      const transcript = await this.o.stt.transcribe(job.audio);
      text = transcript.text.trim();
      rawText = transcript.raw;
    } catch (err) {
      this.setPhase({ name: 'idle' });
      this.addFailure({
        kind: 'stt',
        mode: job.mode,
        message: `Transkription fehlgeschlagen: ${errorMessage(err)}. Deine Aufnahme ist noch da und kann erneut gesendet werden.`,
        audio: job.audio,
        target: job.target,
      });
      return;
    }
    // From here on the audio is no longer referenced and can be collected.

    if (text.length === 0) {
      this.setPhase({ name: 'idle' });
      return;
    }

    if (job.mode === 'dictate') {
      await this.insert(text, rawText, job.releasedAt);
      return;
    }

    if (!job.target || job.targetId === null) {
      this.setPhase({ name: 'idle' });
      this.addFailure({
        kind: 'no-sessions',
        mode: 'agent',
        message: 'Keine Session ausgewählt. Starte einen Agent mit «vb run -- copilot».',
        text,
        rawText,
      });
      return;
    }
    await this.deliver(text, rawText, job.target, job.releasedAt);
  }

  private async insert(text: string, rawText: string | undefined, since: number): Promise<void> {
    this.setPhase({ name: 'inserting', text });
    let result;
    try {
      result = await this.o.inserter.insert(text);
    } catch (err) {
      result = { ok: false as const, reason: 'io' as const, detail: errorMessage(err) };
    }
    if (result.ok) {
      this.setDone({ mode: 'dictate', text, rawText, since });
      return;
    }
    this.setPhase({ name: 'idle' });
    if (result.reason === 'no-textfield') {
      this.addFailure({
        kind: 'no-textfield',
        mode: 'dictate',
        message:
          'Beim Loslassen war kein Eingabefeld fokussiert. Der Text liegt in der Zwischenablage – mit Strg+V einfügen.',
        text,
        rawText,
      });
    } else {
      this.addFailure({
        kind: 'insert',
        mode: 'dictate',
        message: `Einfügen fehlgeschlagen: ${result.detail ?? 'unbekannter Fehler'}`,
        text,
        rawText,
      });
    }
  }

  private async deliver(
    text: string,
    rawText: string | undefined,
    target: SessionInfo,
    since: number,
  ): Promise<void> {
    this.setPhase({ name: 'delivering', text, target });
    const result = await this.o.agents.send(target.id, text);
    if (result.ok) {
      this.update({ lastSessionId: target.id });
      this.setDone({ mode: 'agent', text, rawText, target, since });
      return;
    }
    this.setPhase({ name: 'idle' });
    if (result.reason === 'gone') {
      this.addFailure({
        kind: 'session-gone',
        mode: 'agent',
        message: `${target.name} wurde geschlossen, während du gesprochen hast. Der Text wurde an keine andere Session gesendet.`,
        text,
        rawText,
        target,
      });
    } else {
      const why =
        result.reason === 'busy' ? 'Session ist beschäftigt' : (result.detail ?? 'E/A-Fehler');
      this.addFailure({
        kind: 'delivery',
        mode: 'agent',
        message: `Senden an ${target.name} fehlgeschlagen: ${why}.`,
        text,
        rawText,
        target,
      });
    }
  }

  // ---------------------------------------------------------------- helpers

  private abortRecording(): void {
    this.run++;
    this.endRecordingSideEffects();
    this.o.recorder.cancel();
    this.setPhase({ name: 'idle' });
  }

  private endRecordingSideEffects(): void {
    this.watchdog?.cancel();
    this.watchdog = null;
    this.unsubscribeSessions?.();
    this.unsubscribeSessions = null;
    this.o.input.setWheelCapture(false);
    this.recorderStart = null;
  }

  private setDone(args: {
    mode: HotkeyAction;
    text: string;
    rawText: string | undefined;
    target?: SessionInfo;
    since: number;
  }): void {
    this.setPhase({
      name: 'done',
      mode: args.mode,
      text: args.text,
      rawText: args.rawText,
      target: args.target,
      words: countWords(args.text),
      elapsedMs: this.o.clock.now() - args.since,
    });
  }

  private addFailure(f: {
    kind: FailureKind;
    mode: HotkeyAction;
    message: string;
    text?: string;
    rawText?: string;
    audio?: AudioClip;
    target?: SessionInfo;
  }): void {
    const failure: Failure = { id: `f${++this.failureSeq}`, createdAt: this.o.clock.now(), ...f };
    this.update({ failures: [...this.state.failures, failure] });
  }

  private replaceFailure(id: string, failure: Failure): void {
    this.update({ failures: this.state.failures.map((f) => (f.id === id ? failure : f)) });
  }

  private removeFailure(id: string): void {
    this.update({ failures: this.state.failures.filter((f) => f.id !== id) });
  }

  private setPhase(phase: Phase): void {
    this.update({ phase });
  }

  private update(patch: Partial<ControllerState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function stripView(view: SessionView): SessionInfo {
  const { gone: _gone, ...info } = view;
  return info;
}
