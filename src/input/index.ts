import type { Bindings, InputPort } from '../core';
import type { CapturedInput } from './hook-logic';
import { UiohookInput } from './uiohook';
import { Win32HookInput } from './win32';

export interface PlatformInput extends InputPort {
  start(): void;
  stop(): void;
  setBindings(bindings: Bindings): void;
  captureNext(): Promise<CapturedInput>;
  cancelCapture(): void;
}

export function createPlatformInput(bindings: Bindings): PlatformInput {
  return process.platform === 'win32' ? new Win32HookInput(bindings) : new UiohookInput(bindings);
}
