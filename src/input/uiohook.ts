import { createRequire } from 'node:module';
import type { Bindings, InputEvent, InputPort, MouseButton, RawInput, Unsubscribe } from '../core';
import { uiohookModifier } from '../core';
import { HookState, type CapturedInput } from './hook-logic';

const nodeRequire = createRequire(import.meta.url);

interface UiohookModule {
  uIOhook: {
    on(
      event: string,
      cb: (e: { button?: number; keycode?: number; rotation?: number }) => void,
    ): void;
    removeAllListeners(): void;
    start(): void;
    stop(): void;
  };
}

const BUTTONS: Record<number, MouseButton> = { 3: 'Middle', 4: 'XButton1', 5: 'XButton2' };

/**
 * Fallback for macOS/Linux (X11). uiohook can only listen, not suppress: mouse 4/5 still reach
 * the app below and the wheel still scrolls it. Documented limitation, see README.
 */
export class UiohookInput implements InputPort {
  private readonly state: HookState;
  private readonly listeners = new Set<(e: InputEvent) => void>();
  private hook: UiohookModule['uIOhook'] | null = null;

  constructor(bindings: Bindings) {
    this.state = new HookState(bindings, uiohookModifier);
  }

  start(): void {
    const { uIOhook } = nodeRequire('uiohook-napi') as UiohookModule;
    this.hook = uIOhook;
    const handle = (raw: RawInput) => {
      const r = this.state.onRaw(raw);
      if (r.event) this.dispatch(r.event);
    };
    uIOhook.on('mousedown', (e) => {
      const button = BUTTONS[e.button ?? 0];
      if (button) handle({ device: 'mouse', button, down: true });
    });
    uIOhook.on('mouseup', (e) => {
      const button = BUTTONS[e.button ?? 0];
      if (button) handle({ device: 'mouse', button, down: false });
    });
    uIOhook.on('keydown', (e) =>
      handle({ device: 'keyboard', keycode: e.keycode ?? 0, down: true }),
    );
    uIOhook.on('keyup', (e) =>
      handle({ device: 'keyboard', keycode: e.keycode ?? 0, down: false }),
    );
    uIOhook.on('wheel', (e) => {
      const r = this.state.onWheel((e.rotation ?? 0) > 0 ? 1 : -1);
      if (r.event) this.dispatch(r.event);
    });
    uIOhook.start();
  }

  stop(): void {
    this.hook?.removeAllListeners();
    this.hook?.stop();
    this.hook = null;
  }

  onEvent(cb: (e: InputEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setWheelCapture(enabled: boolean): void {
    this.state.wheelCapture = enabled;
  }

  setBindings(bindings: Bindings): void {
    this.state.bindings = bindings;
  }

  captureNext(): Promise<CapturedInput> {
    return new Promise((resolve) => this.state.startCapture(resolve));
  }

  cancelCapture(): void {
    this.state.cancelCapture();
  }

  private dispatch(event: InputEvent): void {
    setImmediate(() => {
      for (const l of this.listeners) l(event);
    });
  }
}
