import type { Clock, InsertResult, TextInserter } from '../core';
import { errorMessage } from '../core';

/** Opaque copy of the clipboard (all formats the platform layer can carry). */
export type ClipboardSnapshot = unknown;

export interface ClipboardPort {
  snapshot(): Promise<ClipboardSnapshot>;
  restore(snapshot: ClipboardSnapshot): Promise<void>;
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface KeySender {
  /** Sends Ctrl+V (Cmd+V on macOS) to the foreground window. Never Enter. */
  sendPaste(): Promise<void>;
  /** Fallback: types the text as Unicode key events. */
  typeText?(text: string): Promise<void>;
}

export interface FocusProbe {
  /** false = definitely no text field focused; null = cannot tell. */
  hasTextFocus(): Promise<boolean | null>;
}

export interface ClipboardPasteInserterOptions {
  clipboard: ClipboardPort;
  keys: KeySender;
  clock: Clock;
  focus?: FocusProbe;
  restoreClipboardAfterMs?: number;
}

/**
 * Inserts text at the cursor via clipboard + paste shortcut and restores the previous clipboard.
 * If no text field is focused, the text stays in the clipboard and `no-textfield` is reported.
 */
export class ClipboardPasteInserter implements TextInserter {
  private readonly restoreAfterMs: number;

  constructor(private readonly o: ClipboardPasteInserterOptions) {
    this.restoreAfterMs = o.restoreClipboardAfterMs ?? 300;
  }

  async insert(text: string): Promise<InsertResult> {
    const { clipboard, keys, focus, clock } = this.o;
    if (focus && (await focus.hasTextFocus()) === false) {
      await clipboard.writeText(text);
      return { ok: false, reason: 'no-textfield' };
    }

    const saved = await clipboard.snapshot();
    await clipboard.writeText(text);
    try {
      await keys.sendPaste();
    } catch (pasteError) {
      if (!keys.typeText) {
        return { ok: false, reason: 'io', detail: errorMessage(pasteError) };
      }
      try {
        await clipboard.restore(saved);
        await keys.typeText(text);
        return { ok: true };
      } catch (typeError) {
        await clipboard.writeText(text);
        return { ok: false, reason: 'io', detail: errorMessage(typeError) };
      }
    }

    clock.setTimeout(() => {
      // Only restore if nobody else changed the clipboard in the meantime.
      void clipboard
        .readText()
        .then((current) => (current === text ? clipboard.restore(saved) : undefined))
        .catch(() => {});
    }, this.restoreAfterMs);
    return { ok: true };
  }
}
