import { createRequire } from 'node:module';
import type * as KoffiModule from 'koffi';
import type { FocusProbe, KeySender } from './inserter';

const nodeRequire = createRequire(import.meta.url);
type Koffi = typeof KoffiModule;

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const VK_CONTROL = 0x11;
const VK_V = 0x56;

/** Window classes that mean "no text field": desktop and taskbar. */
const NON_TEXT_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

/** SendInput-based keystrokes (Ctrl+V, Unicode typing) and a coarse focus check via koffi. */
export class Win32Keys implements KeySender, FocusProbe {
  private readonly sendInput: (n: number, input: unknown, size: number) => number;
  private readonly inputSize: number;
  private readonly getForegroundWindow: () => unknown;
  private readonly getClassName: (hwnd: unknown, buf: Uint16Array, len: number) => number;

  constructor() {
    const koffi = nodeRequire('koffi') as Koffi;
    const user32 = koffi.load('user32.dll');
    const KEYBDINPUT = koffi.struct('VB_KEYBDINPUT', {
      wVk: 'uint16',
      wScan: 'uint16',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr_t',
    });
    const MOUSEINPUT = koffi.struct('VB_MOUSEINPUT', {
      dx: 'long',
      dy: 'long',
      mouseData: 'uint32',
      dwFlags: 'uint32',
      time: 'uint32',
      dwExtraInfo: 'uintptr_t',
    });
    const INPUT = koffi.struct('VB_INPUT', {
      type: 'uint32',
      u: koffi.union('VB_INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT }),
    });
    this.inputSize = koffi.sizeof(INPUT);
    this.sendInput = user32.func(
      'uint32 __stdcall SendInput(uint32 cInputs, VB_INPUT *pInputs, int cbSize)',
    );
    this.getForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
    this.getClassName = user32.func(
      'int __stdcall GetClassNameW(void *hWnd, _Out_ uint16_t *lpClassName, int nMaxCount)',
    );
  }

  async sendPaste(): Promise<void> {
    this.keys([
      [VK_CONTROL, 0, 0],
      [VK_V, 0, 0],
      [VK_V, 0, KEYEVENTF_KEYUP],
      [VK_CONTROL, 0, KEYEVENTF_KEYUP],
    ]);
  }

  async typeText(text: string): Promise<void> {
    for (const ch of text.replace(/\r\n?/g, '\n')) {
      if (ch === '\n') continue; // never Enter
      for (let i = 0; i < ch.length; i++) {
        const unit = ch.charCodeAt(i);
        this.keys([
          [0, unit, KEYEVENTF_UNICODE],
          [0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP],
        ]);
      }
    }
  }

  async hasTextFocus(): Promise<boolean | null> {
    const hwnd = this.getForegroundWindow();
    if (!hwnd) return false;
    const buf = new Uint16Array(256);
    const len = this.getClassName(hwnd, buf, buf.length);
    const cls = String.fromCharCode(...buf.subarray(0, len));
    if (NON_TEXT_CLASSES.has(cls)) return false;
    return null; // Cannot tell reliably (browsers and Electron apps have no system caret).
  }

  private keys(list: [vk: number, scan: number, flags: number][]): void {
    for (const [wVk, wScan, dwFlags] of list) {
      const sent = this.sendInput(
        1,
        { type: INPUT_KEYBOARD, u: { ki: { wVk, wScan, dwFlags, time: 0, dwExtraInfo: 0 } } },
        this.inputSize,
      );
      if (sent !== 1) throw new Error('SendInput wurde blockiert (UIPI oder sicherer Desktop)');
    }
  }
}
