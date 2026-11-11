import type {
  Clock,
  InputPort,
  RecorderPort,
  SessionLauncher,
  SpeechToText,
  TextInserter,
  TimerHandle,
} from './ports';
import type { AgentRegistry } from './registry';
import { errorMessage } from './registry';
import {
  NEW_SESSION_ID,
  folderName,
  initialSelection,
  mergeSessions,
  moveSelection,
  withNewSessionRow,
} from './selection';
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
  /** A new terminal was opened (T-026); the prompt waits until exactly that session is ready. */
  | { name: 'launching'; text: string; rawText?: string; folder: string; token: string }
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
  /** Opens new agent terminals (T-026). Without it the «Neue Session» row is hidden. */
  launcher?: SessionLauncher;
  /** How long a new session may take until it is ready for input. */
  launchTimeoutMs?: number;
  /** Creates the launch token that binds a prompt to its new session. */
  createToken?: () => string;
}

/** Result of a run that reached transcription. Kept in memory only. */
interface Job {
  mode: HotkeyAction;
  audio: AudioClip;
  target?: SessionInfo;
  /** Set when the «Neue Session» row was chosen: the folder to start the new session in. */
  launchFolder?: string;
  /** For agent runs: the session ID fixed at release time (may be missing → no-sessions). */
  targetId: string | null;
  /** Target the user asked for explicitly (phone); missing means session-gone, not no-sessions. */
  requestedTargetId?: string;
  releasedAt: number;
}

/**
 * The push-to-talk state machine. Pure logic: all I/O goes through the ports.
 * Rules: only the release of the held key ends a recording; the agent target is fixed by ID at
 * release; a vanished target is an error, never a redirect; failures keep text and audio.
 */
export class SessionController {
  private readonly o: Required<Omit<ControllerOptions, 'lastSessionId' | 'launcher'>>;
  private readonly launcher: SessionLauncher | undefined;
  /** Whether the «Neue Session» row is offered in the current recording. */
  private launchEnabled = false;
  private stopLaunchWait: (() => void) | null = null;
  private readonly deskWaits = new Set<() => void>();
  private state: ControllerState;
  private readonly listeners = new Set<(s: ControllerState) => void>();
  private run = 0;
  private recorderStart: Promise<boolean> | null = null;
  private watchdog: TimerHandle | null = null;
  private unsubscribeSessions: (() => void) | null = null;
  private lastWheelAt = Number.NEGATIVE_INFINITY;
  private preferredTargetId: string | undefined;
  private failureSeq = 0;
  private sttAbort: AbortController | null = null;
  private cancelCapture = false;
  private readonly unsubscribeInput: () => void;

  constructor(options: ControllerOptions) {
    this.o = {
      minHoldMs: 300,
      maxRecordingMs: 120_000,
      wheelDebounceMs: 120,
      launchTimeoutMs: 20_000,
      createToken: randomToken,
      ...options,
    };
    this.launcher = options.launcher;
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
    this.stopLaunchWait?.();
    for (const stop of [...this.deskWaits]) stop();
    this.listeners.clear();
  }

  /** Applies changed timing settings without losing open failures. */
  configure(
    options: Partial<Pick<ControllerOptions, 'minHoldMs' | 'maxRecordingMs' | 'wheelDebounceMs'>>,
  ): void {
    Object.assign(this.o, options);
  }

  /** Discards a running recording without processing it (e.g. cancelled on the phone). */
  cancelRecording(): void {
    if (this.state.phase.name === 'recording') this.abortRecording();
  }

  /**
   * Escape: discards the run while recording or transcribing. The user chose to drop it, so no
   * failure is kept. Once text is being inserted or delivered it is too late to cancel.
   */
  cancel(): void {
    const name = this.state.phase.name;
    if (name === 'recording') {
      this.abortRecording();
    } else if (name === 'transcribing') {
      this.run++;
      this.sttAbort?.abort();
      this.sttAbort = null;
      this.o.recorder.cancel();
      this.setPhase({ name: 'idle' });
    }
  }

  setPaused(paused: boolean): void {
    if (paused && this.state.phase.name === 'recording') this.abortRecording();
    this.update({ paused });
  }

  handleInput(event: InputEvent): void {
    switch (event.type) {
      case 'down':
        this.onDown(event.action, event.targetId);
        break;
      case 'up':
        this.onUp(event.action);
        break;
      case 'wheel':
        this.onWheel(event.delta);
        break;
      case 'cancel':
        this.cancel();
        break;
    }
  }

  /** Click on a popup row. Changes the target only; the recording continues. */
  selectSession(sessionId: string): void {
    const phase = this.state.phase;
    if (phase.name !== 'recording' || phase.mode !== 'agent') return;
    const view = phase.sessions.find((s) => s.id === sessionId);
    if (!view || view.gone) return;
    this.setPhase({ ...phase, selectedId: sessionId, sessions: this.withRow(phase, sessionId) });
  }

  /** Agent Desk: fixes the agent target by ID (ADR-018). The next agent run preselects it. */
  pinSession(sessionId: string): void {
    if (sessionId === NEW_SESSION_ID || sessionId === this.state.lastSessionId) return;
    this.update({ lastSessionId: sessionId });
  }

  /** Whether «＋ Neue Session» can open a terminal (T-026 launcher). */
  canLaunch(): boolean {
    return this.launcherAvailable();
  }

  /**
   * Agent Desk «＋ Neue Session»: opens a terminal through the T-026 launcher and pins the session
   * carrying the launch token once it registers – unless the user pinned another one meanwhile.
   */
  async launchSession(
    folder: string,
  ): Promise<{ ok: true; sessionId: string } | { ok: false; message: string }> {
    const name = folderName(folder);
    const token = this.o.createToken();
    const pinnedBefore = this.state.lastSessionId;
    try {
      if (!this.launcher) throw new Error('kein Terminal verfügbar');
      await this.launcher.launch(folder, token);
    } catch (err) {
      return {
        ok: false,
        message: `Neue Session in ${name} konnte nicht gestartet werden: ${errorMessage(err)}.`,
      };
    }
    const session = await this.waitForRegistered(token);
    if (!session) {
      return {
        ok: false,
        message: `Die neue Session in ${name} hat sich nicht gemeldet. Prüfen, ob das Terminal gestartet ist.`,
      };
    }
    if (this.state.lastSessionId === pinnedBefore) this.pinSession(session.id);
    return { ok: true, sessionId: session.id };
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
          launchFolder: failure.launch?.folder,
          targetId: failure.launch ? NEW_SESSION_ID : (failure.target?.id ?? null),
          releasedAt: this.o.clock.now(),
        });
      } else if (failure.kind === 'launch' && failure.text !== undefined && failure.launch) {
        // Never two runs at once: a retry while something else runs is ignored.
        const name = this.state.phase.name;
        if (name !== 'idle' && name !== 'done') return;
        this.removeFailure(failureId);
        await this.launchAndDeliver(
          failure.text,
          failure.rawText,
          failure.launch.folder,
          failure.launch.token,
          this.o.clock.now(),
        );
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

  private onDown(action: HotkeyAction, preferredTargetId?: string): void {
    if (this.state.paused) return;
    const name = this.state.phase.name;
    if (name !== 'idle' && name !== 'done') return;

    const runId = ++this.run;
    this.preferredTargetId = preferredTargetId;
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
    this.launchEnabled = this.launcherAvailable();
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
      const selectedId = phase.selectedId ?? this.chooseInitial(fresh);
      const sessions = fresh.map((s) => ({ ...s, gone: false }));
      this.setPhase({
        ...phase,
        loading: false,
        sessions: this.withRow({ sessions }, selectedId),
        selectedId,
      });
    });
  }

  private onSessionsChanged(runId: number, fresh: SessionInfo[]): void {
    const phase = this.state.phase;
    if (this.run !== runId || phase.name !== 'recording' || phase.mode !== 'agent') return;
    // The virtual row is no real session: it never becomes "gone" and is rebuilt below.
    const real = phase.sessions.filter((s) => !s.newSession);
    const mergeId = phase.selectedId === NEW_SESSION_ID ? null : phase.selectedId;
    const merged = mergeSessions(real, fresh, mergeId);
    // Only an empty selection may be filled automatically; a chosen one is never replaced.
    const selectedId = phase.selectedId ?? this.chooseInitial(fresh);
    const sessions = withNewSessionRow(
      merged,
      selectedId,
      rowCwd(phase.sessions),
      this.launchEnabled,
      this.state.lastSessionId,
    );
    this.setPhase({ ...phase, loading: false, sessions, selectedId });
  }

  /** Rebuilds the «Neue Session» row so its folder follows the selected session. */
  private withRow(phase: { sessions: SessionView[] }, selectedId: string | null): SessionView[] {
    return withNewSessionRow(
      phase.sessions,
      selectedId,
      rowCwd(phase.sessions),
      this.launchEnabled,
      this.state.lastSessionId,
    );
  }

  private launcherAvailable(): boolean {
    try {
      return this.launcher?.available() ?? false;
    } catch {
      return false;
    }
  }

  /**
   * An explicitly requested target (from the phone) is never replaced by another session: if it is
   * missing, nothing is selected and the release ends in a session-gone failure.
   */
  private chooseInitial(fresh: SessionInfo[]): string | null {
    const wanted = this.preferredTargetId;
    if (wanted !== undefined) return fresh.some((s) => s.id === wanted) ? wanted : null;
    return initialSelection(fresh, this.state.lastSessionId);
  }

  private onWheel(delta: 1 | -1): void {
    const phase = this.state.phase;
    if (phase.name !== 'recording' || phase.mode !== 'agent') return;
    const now = this.o.clock.now();
    if (now - this.lastWheelAt < this.o.wheelDebounceMs) return;
    this.lastWheelAt = now;
    const selectedId = moveSelection(phase.sessions, phase.selectedId, delta);
    this.setPhase({ ...phase, selectedId, sessions: this.withRow(phase, selectedId) });
  }

  private onUp(action: HotkeyAction): void {
    const phase = this.state.phase;
    if (phase.name !== 'recording' || phase.mode !== action) return;
    const runId = this.run;
    const releasedAt = this.o.clock.now();
    const heldMs = releasedAt - phase.startedAt;
    const selected =
      phase.mode === 'agent' ? phase.sessions.find((s) => s.id === phase.selectedId) : undefined;
    const launchFolder = selected?.newSession ? selected.cwd : undefined;
    const target = selected?.newSession ? undefined : selected;
    const targetId = phase.mode === 'agent' ? phase.selectedId : null;
    const started = this.recorderStart ?? Promise.resolve(false);
    this.endRecordingSideEffects();

    if (heldMs < this.o.minHoldMs) {
      this.o.recorder.cancel();
      this.setPhase({ name: 'idle' });
      return;
    }

    const fixedTarget = target ? stripView(target) : undefined;
    const requestedTargetId = phase.mode === 'agent' ? this.preferredTargetId : undefined;
    this.setPhase({ name: 'transcribing', mode: action, target: fixedTarget });

    void started.then(async (ok) => {
      if (!ok || this.run !== runId) return;
      let audio: AudioClip;
      try {
        audio = await this.o.recorder.stop();
      } catch (err) {
        if (this.run !== runId) return;
        this.setPhase({ name: 'idle' });
        this.addFailure({
          kind: 'recorder',
          mode: action,
          message: `Aufnahme fehlgeschlagen: ${errorMessage(err)}`,
        });
        return;
      }
      if (this.run !== runId) return;
      await this.process({
        mode: action,
        audio,
        target: fixedTarget,
        launchFolder,
        targetId,
        requestedTargetId,
        releasedAt,
      });
    });
  }

  // ---------------------------------------------------------------- pipeline

  private async process(job: Job): Promise<void> {
    this.setPhase({ name: 'transcribing', mode: job.mode, target: job.target });
    const runId = this.run;
    const abort = new AbortController();
    this.sttAbort = abort;
    let text: string;
    let rawText: string | undefined;
    try {
      const transcript = await this.o.stt.transcribe(job.audio, { signal: abort.signal });
      if (this.run !== runId) return;
      text = transcript.text.trim();
      rawText = transcript.raw;
    } catch (err) {
      if (this.run !== runId) return;
      this.setPhase({ name: 'idle' });
      this.addFailure({
        kind: 'stt',
        mode: job.mode,
        message: `Transkription fehlgeschlagen: ${errorMessage(err)}. Deine Aufnahme ist noch da und kann erneut gesendet werden.`,
        audio: job.audio,
        target: job.target,
        ...(job.launchFolder ? { launch: { folder: job.launchFolder } } : {}),
      });
      return;
    } finally {
      if (this.sttAbort === abort) this.sttAbort = null;
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

    if (job.launchFolder !== undefined) {
      await this.launchAndDeliver(text, rawText, job.launchFolder, undefined, job.releasedAt);
      return;
    }

    if (!job.target || job.targetId === null) {
      this.setPhase({ name: 'idle' });
      if (job.requestedTargetId) {
        this.addFailure({
          kind: 'session-gone',
          mode: 'agent',
          message:
            'Die gewählte Session ist nicht mehr da. Der Text wurde an keine andere Session gesendet.',
          text,
          rawText,
        });
        return;
      }
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

  /**
   * Opens a new terminal bound to a fresh token (unless `token` says it is already open) and sends
   * the text once exactly that session is registered and ready for input. Copilot may first ask
   * whether to trust the folder; the session only reports ready after that, so the prompt never
   * answers the question. On timeout the text is kept – never sent to another session.
   */
  private async launchAndDeliver(
    text: string,
    rawText: string | undefined,
    folder: string,
    existingToken: string | undefined,
    since: number,
  ): Promise<void> {
    const token = existingToken ?? this.o.createToken();
    this.setPhase({ name: 'launching', text, rawText, folder, token });
    const runId = this.run;
    const keep = { text, rawText };

    if (existingToken === undefined) {
      try {
        if (!this.launcher) throw new Error('kein Terminal verfügbar');
        await this.launcher.launch(folder, token);
      } catch (err) {
        if (this.run !== runId) return;
        this.setPhase({ name: 'idle' });
        this.addFailure({
          kind: 'launch',
          mode: 'agent',
          message: `Neue Session in ${folderName(folder)} konnte nicht gestartet werden: ${errorMessage(err)}. Der Text ist erhalten.`,
          ...keep,
          launch: { folder },
        });
        return;
      }
    }

    const { session, seen } = await this.waitForLaunched(token);
    if (this.run !== runId) return;
    if (session) {
      await this.deliver(text, rawText, session, since);
      return;
    }
    this.setPhase({ name: 'idle' });
    const name = folderName(folder);
    this.addFailure({
      kind: 'launch',
      mode: 'agent',
      message: seen
        ? `Die neue Session in ${name} ist noch nicht bereit. Im Terminal bestätigen (z. B. die Frage, ob dem Ordner vertraut wird), dann «Nochmals». Der Text wurde an keine andere Session gesendet.`
        : `Die neue Session in ${name} hat sich nicht gemeldet. Im Terminal bestätigen oder prüfen, ob es gestartet ist, dann «Nochmals». Der Text wurde an keine andere Session gesendet.`,
      ...keep,
      launch: { folder, token },
    });
  }

  /** Resolves with the session carrying `token` once it is idle, or with null after the timeout. */
  private waitForLaunched(token: string): Promise<{ session: SessionInfo | null; seen: boolean }> {
    return new Promise((resolve) => {
      let seen = false;
      let finished = false;
      const finish = (session: SessionInfo | null) => {
        if (finished) return;
        finished = true;
        unsubscribe();
        timer.cancel();
        this.stopLaunchWait = null;
        resolve({ session, seen });
      };
      const check = (sessions: SessionInfo[]) => {
        const s = sessions.find((x) => x.launchToken === token);
        if (!s) return;
        seen = true;
        if (s.state === 'idle') finish(s);
      };
      const unsubscribe = this.o.agents.onChange(check);
      const timer = this.o.clock.setTimeout(() => finish(null), this.o.launchTimeoutMs);
      this.stopLaunchWait = () => {
        finished = true;
        unsubscribe();
        timer.cancel();
        this.stopLaunchWait = null;
      };
      void this.o.agents.listSessions().then(check, () => undefined);
    });
  }

  // ---------------------------------------------------------------- helpers

  /** Resolves with the session carrying `token` as soon as it registers (any state), or null. */
  private waitForRegistered(token: string): Promise<SessionInfo | null> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (session: SessionInfo | null) => {
        if (finished) return;
        finished = true;
        unsubscribe();
        timer.cancel();
        this.deskWaits.delete(stop);
        resolve(session);
      };
      const stop = () => finish(null);
      const check = (sessions: SessionInfo[]) => {
        const s = sessions.find((x) => x.launchToken === token);
        if (s) finish(s);
      };
      const unsubscribe = this.o.agents.onChange(check);
      const timer = this.o.clock.setTimeout(stop, this.o.launchTimeoutMs);
      this.deskWaits.add(stop);
      void this.o.agents.listSessions().then(check, () => undefined);
    });
  }

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
    launch?: { folder: string; token?: string };
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
    const cancellable = phase.name === 'recording' || phase.name === 'transcribing';
    if (cancellable !== this.cancelCapture) {
      this.cancelCapture = cancellable;
      this.o.input.setCancelCapture(cancellable);
    }
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

function rowCwd(views: readonly SessionView[]): string | undefined {
  return views.find((v) => v.newSession)?.cwd;
}

/** 8 hex characters. Not a secret: it only tells our own new terminal apart from others. */
function randomToken(): string {
  return Math.floor(Math.random() * 0x1_0000_0000)
    .toString(16)
    .padStart(8, '0');
}

function stripView(view: SessionView): SessionInfo {
  const { gone: _gone, ...info } = view;
  return info;
}
