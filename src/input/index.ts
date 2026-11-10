import type { Bindings, InputPort, RawInput } from '../core';
import { UiohookInput } from './uiohook';
import { Win32HookInput } from './win32';

export interface PlatformInput extends InputPort {
  start(): void;
  stop(): void;
  setBindings(bindings: Bindings): void;
  captureNext(): Promise<RawInput>;
  cancelCapture(): void;
}

export function createPlatformInput(bindings: Bindings): PlatformInput {
  return process.platform === 'win32' ? new Win32HookInput(bindings) : new UiohookInput(bindings);
}
