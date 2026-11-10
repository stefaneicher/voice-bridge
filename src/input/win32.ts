import { createRequire } from 'node:module';
import type * as KoffiModule from 'koffi';
import type { Bindings, InputEvent, InputPort, Unsubscribe } from '../core';
import { windowsModifier } from '../core';
import { HookState, decodeKey, decodeMouse, type CapturedInput } from './hook-logic';

const nodeRequire = createRequire(import.meta.url);

const WH_KEYBOARD_LL = 13;
const WH_MOUSE_LL = 14;
const LLMHF_INJECTED = 0x01;
const LLKHF_INJECTED = 0x10;

type Koffi = typeof KoffiModule;

/**
 * Global mouse/keyboard hooks via SetWindowsHookExW, called through koffi (ADR-003).
 * Must be installed on the Electron main thread, which runs a Win32 message loop.
 * The callback only decodes, queues the event and returns: it must stay under 1 ms.
 */
export class Win32HookInput implements InputPort {
  private state: HookState;
  private readonly listeners = new Set<(e: InputEvent) => void>();
  private hooks: unknown[] = [];
  private callbacks: unknown[] = [];
  private koffi: Koffi | null = null;
  private unhook: ((h: unknown) => boolean) | null = null;

  constructor(bindings: Bindings) {
    this.state = new HookState(bindings, windowsModifier);
  }

  start(): void {
    if (this.hooks.length) return;
    const koffi = nodeRequire('koffi') as Koffi;
    this.koffi = koffi;
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
    this.state = new HookState(
      this.state.bindings,
      windowsModifier,
      (vk) => ((GetAsyncKeyState(vk) as number) & 0x8000) !== 0,
    );

    const POINT = koffi.struct('VB_POINT', { x: 'long', y: 'long' });
    const MSLL = koffi.struct('VB_MSLLHOOKSTRUCT', {
      pt: POINT,
      mouseData: 'uint32',
      flags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr_t',
    });
    const KBDLL = koffi.struct('VB_KBDLLHOOKSTRUCT', {
      vkCode: 'uint32',
      scanCode: 'uint32',
      flags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr_t',
    });
    const HookProc = koffi.proto(
      'intptr_t __stdcall VB_HookProc(int nCode, uintptr_t wParam, void *lParam)',
    );
    const SetWindowsHookExW = user32.func(
      'void * __stdcall SetWindowsHookExW(int idHook, VB_HookProc *lpfn, void *hmod, uint32_t dwThreadId)',
    );
    const CallNextHookEx = user32.func(
      'intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)',
    );
    const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void *hhk)');
    const GetModuleHandleW = kernel32.func(
      'void * __stdcall GetModuleHandleW(const char16_t *name)',
    );
    this.unhook = (h) => UnhookWindowsHookEx(h) as boolean;
    const hmod = GetModuleHandleW(null);

    const mouseProc = koffi.register((nCode: number, wParam: number, lParam: unknown) => {
      if (nCode === 0) {
        const m = koffi.decode(lParam, MSLL) as { mouseData: number; flags: number };
        if (!(m.flags & LLMHF_INJECTED)) {
          const decoded = decodeMouse(Number(wParam), m.mouseData);
          if (decoded) {
            const r =
              'wheel' in decoded
                ? this.state.onWheel(decoded.wheel)
                : this.state.onRaw(decoded.raw);
            if (r.event) this.dispatch(r.event);
            if (r.suppress) return 1;
          }
        }
      }
      return CallNextHookEx(null, nCode, wParam, lParam);
    }, koffi.pointer(HookProc));

    const keyProc = koffi.register((nCode: number, wParam: number, lParam: unknown) => {
      if (nCode === 0) {
        const k = koffi.decode(lParam, KBDLL) as { vkCode: number; flags: number };
        if (!(k.flags & LLKHF_INJECTED)) {
          const raw = decodeKey(Number(wParam), k.vkCode);
          if (raw) {
            const r = this.state.onRaw(raw);
            if (r.event) this.dispatch(r.event);
            if (r.suppress) return 1;
          }
        }
      }
      return CallNextHookEx(null, nCode, wParam, lParam);
    }, koffi.pointer(HookProc));

    this.callbacks = [mouseProc, keyProc];
    for (const [id, proc] of [
      [WH_MOUSE_LL, mouseProc],
      [WH_KEYBOARD_LL, keyProc],
    ] as const) {
      const hook = SetWindowsHookExW(id, proc, hmod, 0);
      if (!hook) throw new Error(`SetWindowsHookExW(${id}) fehlgeschlagen`);
      this.hooks.push(hook);
    }
  }

  stop(): void {
    for (const h of this.hooks) this.unhook?.(h);
    this.hooks = [];
    for (const cb of this.callbacks) this.koffi?.unregister(cb as never);
    this.callbacks = [];
  }

  onEvent(cb: (e: InputEvent) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setWheelCapture(enabled: boolean): void {
    this.state.wheelCapture = enabled;
  }

  setCancelCapture(enabled: boolean): void {
    this.state.escapeCapture = enabled;
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
    // Leave the hook callback immediately; handle the event on the next tick.
    setImmediate(() => {
      for (const l of this.listeners) l(event);
    });
  }
}
