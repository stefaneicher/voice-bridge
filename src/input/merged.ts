import type { InputEvent, InputPort, Unsubscribe } from '../core';

/** Combines the OS hook with other event sources (the phone) into one InputPort. */
export class MergedInput implements InputPort {
  private readonly listeners = new Set<(e: InputEvent) => void>();

  constructor(private readonly platform: InputPort) {}

  onEvent(cb: (e: InputEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    const off = this.platform.onEvent(cb);
    return () => {
      this.listeners.delete(cb);
      off();
    };
  }

  /** Injects an event from another source. */
  emit(event: InputEvent): void {
    for (const l of this.listeners) l(event);
  }

  setWheelCapture(enabled: boolean): void {
    this.platform.setWheelCapture(enabled);
  }
}
