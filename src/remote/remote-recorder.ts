import type { AudioClip, RecorderPort } from '../core';
import { wrapPcm16 } from '../audio/wav';
import { REMOTE_SAMPLE_RATE } from './protocol';

/** Upper bound for one phone recording (10 min of 16 kHz PCM16). */
const MAX_BYTES = REMOTE_SAMPLE_RATE * 2 * 600;

/** Collects PCM chunks from the phone in memory. */
export class RemoteAudioBuffer {
  private chunks: Uint8Array[] = [];
  private size = 0;

  push(chunk: Uint8Array): void {
    if (this.size + chunk.length > MAX_BYTES) return;
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  toClip(): AudioClip {
    const pcm = new Uint8Array(this.size);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    this.size = 0;
    return {
      data: wrapPcm16(pcm, REMOTE_SAMPLE_RATE),
      mimeType: 'audio/wav',
      durationMs: Math.round((pcm.length / 2 / REMOTE_SAMPLE_RATE) * 1000),
    };
  }
}

/**
 * RecorderPort that uses the local microphone, or the phone's audio while a remote recording runs.
 * The controller does not know where the audio comes from.
 */
export class SwitchingRecorder implements RecorderPort {
  private remote: RemoteAudioBuffer | null = null;

  constructor(private readonly local: RecorderPort) {}

  /** Routes the next recording to this buffer. Call before the controller starts recording. */
  useRemote(buffer: RemoteAudioBuffer): void {
    this.remote = buffer;
  }

  useLocal(): void {
    this.remote = null;
  }

  get isRemote(): boolean {
    return this.remote !== null;
  }

  start(): Promise<void> {
    return this.remote ? Promise.resolve() : this.local.start();
  }

  stop(): Promise<AudioClip> {
    return this.remote ? Promise.resolve(this.remote.toClip()) : this.local.stop();
  }

  cancel(): void {
    if (this.remote) this.remote.toClip();
    else this.local.cancel();
  }
}
