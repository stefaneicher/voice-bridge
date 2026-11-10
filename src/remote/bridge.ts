import type {
  AgentRegistry,
  ControllerState,
  HotkeyAction,
  InputEvent,
  SessionController,
} from '../core';
import type { RemoteTarget } from './protocol';
import { RemoteAudioBuffer, type SwitchingRecorder } from './remote-recorder';
import type { RemoteClient, RemoteHost } from './server';

export interface RemoteBridgeOptions {
  pcName: string;
  profile: string;
  controller: SessionController;
  agents: AgentRegistry;
  recorder: SwitchingRecorder;
  /** Feeds input events into the controller (MergedInput.emit). */
  emit: (event: InputEvent) => void;
}

interface ActiveRun {
  client: RemoteClient;
  mode: HotkeyAction;
  buffer: RemoteAudioBuffer;
  knownFailures: Set<string>;
  released: boolean;
}

/**
 * Connects phone recordings to the normal push-to-talk flow: a phone press becomes a hotkey down
 * (with the chosen target), its audio replaces the microphone, and the outcome goes back to the
 * phone. Only one recording runs at a time, local or remote.
 */
export class RemoteBridge implements RemoteHost {
  readonly pcName: string;
  readonly profile: string;
  private active: ActiveRun | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly o: RemoteBridgeOptions) {
    this.pcName = o.pcName;
    this.profile = o.profile;
    this.unsubscribe = o.controller.subscribe((s) => this.onState(s));
  }

  dispose(): void {
    this.unsubscribe();
  }

  async listTargets(): Promise<RemoteTarget[]> {
    return (await this.o.agents.listSessions()).map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.title ? { title: s.title } : {}),
      state: s.state,
    }));
  }

  onTargetsChanged(cb: () => void): () => void {
    return this.o.agents.onChange(() => cb());
  }

  begin(client: RemoteClient, mode: HotkeyAction, target: string | undefined): boolean {
    const state = this.o.controller.getState();
    const idle = state.phase.name === 'idle' || state.phase.name === 'done';
    if (this.active || !idle || state.paused) return false;

    const buffer = new RemoteAudioBuffer();
    this.o.recorder.useRemote(buffer);
    this.active = {
      client,
      mode,
      buffer,
      knownFailures: new Set(state.failures.map((f) => f.id)),
      released: false,
    };
    this.o.emit({ type: 'down', action: mode, ...(target ? { targetId: target } : {}) });

    if (this.o.controller.getState().phase.name !== 'recording') {
      this.finish();
      return false;
    }
    return true;
  }

  audio(client: RemoteClient, chunk: Uint8Array): void {
    if (this.active?.client === client && !this.active.released) this.active.buffer.push(chunk);
  }

  end(client: RemoteClient): void {
    if (this.active?.client !== client || this.active.released) return;
    this.active.released = true;
    this.o.emit({ type: 'up', action: this.active.mode });
  }

  cancel(client: RemoteClient): void {
    if (this.active?.client !== client) return;
    this.o.controller.cancelRecording();
    client.send({ t: 'status', phase: 'idle' });
    this.finish();
  }

  private onState(state: ControllerState): void {
    const run = this.active;
    if (!run || !run.released) return;
    const phase = state.phase;
    switch (phase.name) {
      case 'transcribing':
        run.client.send({ t: 'status', phase: 'working', label: 'Transkribiere …' });
        return;
      case 'inserting':
        run.client.send({ t: 'status', phase: 'working', label: 'Füge ein …' });
        return;
      case 'delivering':
        run.client.send({
          t: 'status',
          phase: 'working',
          label: `Sende an ${phase.target.name} …`,
        });
        return;
      case 'done':
        run.client.send({
          t: 'result',
          ok: true,
          text: phase.text,
          ...(phase.target ? { target: phase.target.name } : {}),
        });
        this.finish();
        return;
      case 'idle':
        // The controller sets idle first and adds a failure right after: look once it settled.
        queueMicrotask(() => this.settle(run));
        return;
      default:
        return;
    }
  }

  private settle(run: ActiveRun): void {
    if (this.active !== run) return;
    const failure = this.o.controller.getState().failures.find((f) => !run.knownFailures.has(f.id));
    if (failure) {
      run.client.send({
        t: 'result',
        ok: false,
        kind: failure.kind,
        message: failure.message,
        ...(failure.text ? { text: failure.text } : {}),
      });
    } else {
      // Too short or nothing recognised: dropped silently, as with the mouse button.
      run.client.send({ t: 'status', phase: 'idle' });
    }
    this.finish();
  }

  private finish(): void {
    this.o.recorder.useLocal();
    this.active = null;
  }
}
