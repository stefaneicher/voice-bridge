import { ipcMain, type WebContents } from 'electron';
import type { AudioClip, RecorderPort } from '../core';
import { IPC, type RecorderCommand, type RecorderReply } from '../shared/ipc';

type Command = RecorderCommand extends infer C
  ? C extends { id: number }
    ? Omit<C, 'id'>
    : never
  : never;

/**
 * RecorderPort backed by Web Audio in a hidden renderer window (decision on O-2, ADR-007).
 * Audio stays in memory; the WAV bytes travel over IPC once, at release. With live
 * transcription, 24 kHz PCM additionally streams to the main process while recording.
 */
export class ElectronRecorder implements RecorderPort {
  private seq = 0;
  private readonly pending = new Map<number, (r: RecorderReply) => void>();
  private markReady: () => void = () => {};
  /** Resolves once the recorder window has registered its command listener. */
  private readonly ready = new Promise<void>((r) => (this.markReady = r));

  constructor(
    private readonly contents: () => WebContents | null,
    private readonly deviceId: () => string,
    private readonly onLevel: (level: number) => void,
    private readonly timeoutMs = 5000,
    /** Live stream hooks (ADR-016): whether to stream PCM on start, and where it goes. */
    private readonly live?: { stream: () => boolean; onPcm: (pcm: Uint8Array) => void },
  ) {
    ipcMain.on(IPC.recorderReply, (e, reply: RecorderReply) => {
      if (e.sender !== this.contents()) return;
      this.pending.get(reply.id)?.(reply);
      this.pending.delete(reply.id);
    });
    ipcMain.on(IPC.recorderReady, (e) => {
      if (e.sender === this.contents()) this.markReady();
    });
    ipcMain.on(IPC.recorderLevel, (e, level: number) => {
      if (e.sender === this.contents() && typeof level === 'number') this.onLevel(level);
    });
    ipcMain.on(IPC.recorderPcm, (e, pcm: unknown) => {
      if (e.sender === this.contents() && pcm instanceof Uint8Array) this.live?.onPcm(pcm);
    });
  }

  async start(): Promise<void> {
    await this.call({
      type: 'start',
      deviceId: this.deviceId(),
      stream: this.live?.stream() ?? false,
    });
  }

  async stop(): Promise<AudioClip> {
    const r = await this.call({ type: 'stop' });
    if (!r.wav) throw new Error('Keine Audiodaten');
    return { data: new Uint8Array(r.wav), mimeType: 'audio/wav', durationMs: r.durationMs ?? 0 };
  }

  cancel(): void {
    void this.call({ type: 'cancel' }).catch(() => {});
  }

  async warm(enabled: boolean): Promise<void> {
    await this.call({ type: 'warm', deviceId: this.deviceId(), enabled });
  }

  private async call(command: Command): Promise<Extract<RecorderReply, { ok: true }>> {
    await Promise.race([this.ready, delay(this.timeoutMs)]);
    const wc = this.contents();
    if (!wc || wc.isDestroyed()) return Promise.reject(new Error('Recorder nicht bereit'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Recorder antwortet nicht'));
      }, this.timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        if (r.ok) resolve(r);
        else reject(new Error(r.error));
      });
      wc.send(IPC.recorderCommand, { ...command, id } as RecorderCommand);
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
