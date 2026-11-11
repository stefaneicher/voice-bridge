/// <reference types="svelte" />
import type { RecorderCommand, RecorderReply, VoiceBridgeApi } from '../shared/ipc';

declare global {
  interface Window {
    vb: VoiceBridgeApi;
    vbRecorder: {
      onCommand(cb: (c: RecorderCommand) => void): () => void;
      reply(r: RecorderReply): void;
      level(level: number): void;
      pcm(pcm: Uint8Array): void;
      ready(): void;
    };
  }
}
export {};
