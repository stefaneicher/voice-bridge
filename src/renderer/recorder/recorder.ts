import { StreamResampler, encodeWav, level, resample, toPcm16 } from '../../audio/wav';
import type { RecorderCommand, RecorderReply } from '../../shared/ipc';

const TARGET_RATE = 16_000;
/** Live stream format of the realtime transcription API (ADR-016). */
const STREAM_RATE = 24_000;
const STREAM_BATCH = STREAM_RATE / 10;
const LEVEL_INTERVAL_MS = 33;

/**
 * Microphone capture in the hidden recorder window (Web Audio). Samples are only collected between
 * start and stop and live in memory; nothing is written to disk.
 */
class Recorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private chunks: Float32Array[] = [];
  private recording = false;
  private warm = false;
  private deviceId = 'default';
  private levelAcc: number[] = [];
  private lastLevelAt = 0;
  private streamer: StreamResampler | null = null;
  private streamBuf: Float32Array[] = [];
  private streamLen = 0;

  async handle(c: RecorderCommand): Promise<RecorderReply> {
    try {
      switch (c.type) {
        case 'warm':
          this.warm = c.enabled;
          if (c.enabled) await this.ensure(c.deviceId);
          else if (!this.recording) this.release();
          return { id: c.id, ok: true };
        case 'start':
          await this.ensure(c.deviceId);
          await this.ctx!.resume();
          this.chunks = [];
          this.resetStream(
            c.stream ? new StreamResampler(this.ctx!.sampleRate, STREAM_RATE) : null,
          );
          this.recording = true;
          return { id: c.id, ok: true };
        case 'stop': {
          this.recording = false;
          this.flushStream();
          this.resetStream(null);
          const rate = this.ctx?.sampleRate ?? TARGET_RATE;
          const merged = merge(this.chunks);
          this.chunks = [];
          if (!this.warm) this.release();
          const pcm = resample(merged, rate, TARGET_RATE);
          return {
            id: c.id,
            ok: true,
            wav: encodeWav(pcm, TARGET_RATE),
            durationMs: Math.round((pcm.length / TARGET_RATE) * 1000),
          };
        }
        case 'cancel':
          this.recording = false;
          this.chunks = [];
          this.resetStream(null);
          if (!this.warm) this.release();
          return { id: c.id, ok: true };
      }
    } catch (err) {
      return { id: c.id, ok: false, error: describe(err) };
    }
  }

  private async ensure(deviceId: string): Promise<void> {
    if (this.stream && this.ctx && deviceId === this.deviceId) return;
    this.release();
    this.deviceId = deviceId;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor avoids loading a worklet module from file:// under a strict CSP.
    const processor = this.ctx.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (e) => this.onFrame(e.inputBuffer.getChannelData(0));
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(this.ctx.destination);
    this.nodes = [source, processor, sink];
  }

  private onFrame(frame: Float32Array): void {
    if (!this.recording) return;
    this.chunks.push(new Float32Array(frame));
    if (this.streamer) {
      const out = this.streamer.push(frame);
      this.streamBuf.push(out);
      this.streamLen += out.length;
      if (this.streamLen >= STREAM_BATCH) this.flushStream();
    }
    this.levelAcc.push(level(frame));
    const now = performance.now();
    if (now - this.lastLevelAt >= LEVEL_INTERVAL_MS) {
      this.lastLevelAt = now;
      window.vbRecorder.level(Math.max(...this.levelAcc));
      this.levelAcc = [];
    }
  }

  private flushStream(): void {
    if (this.streamLen === 0) return;
    window.vbRecorder.pcm(toPcm16(merge(this.streamBuf)));
    this.streamBuf = [];
    this.streamLen = 0;
  }

  private resetStream(streamer: StreamResampler | null): void {
    this.streamer = streamer;
    this.streamBuf = [];
    this.streamLen = 0;
  }

  private release(): void {
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

function merge(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function describe(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'Zugriff auf das Mikrofon verweigert';
  }
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'Kein Mikrofon gefunden';
  return err instanceof Error ? err.message : String(err);
}

export function startRecorder(): void {
  const recorder = new Recorder();
  window.vbRecorder.onCommand((c) => {
    void recorder.handle(c).then((r) => window.vbRecorder.reply(r));
  });
  window.vbRecorder.ready();
}
